# NativeScript bridge — icon names, the compiled subset, and what it costs

How `@gjsify/adwaita-nativescript` turns `iconName: 'list-add-symbolic'` into pixels, why the
set of glyphs it ships is a SUBSET, and the two failures that shaped both answers. The rule
lives in [`packages/nativescript-bridge/AGENTS.md`](../packages/nativescript-bridge/AGENTS.md);
this is the detail behind it. Decision record: ADR 0034 § Amendment 16.

## Two doors, one property

Every icon property on the port — `GtkImage.iconName`, `AdwStatusPage.iconName`,
`AdwButtonRow.startIconName`, a toggle descriptor's `icon`, and the rest — takes **either** an
Adwaita icon NAME **or** an Adwaita symbolic SVG SOURCE string. `widgets/icon-theme.ts` is the
whole discrimination, and it guesses nothing: the two grammars are disjoint, because a name is
one CSS token and an SVG document starts with `<`.

Name resolution goes through `normalizeIconName` from `@gjsify/adwaita-core` — **the same
function `@gjsify/adwaita-web` resolves through**. That is the cross-renderer guarantee, and it
is a shared function rather than a shared table on purpose: a second table is the copy that
drifts. `list-add-symbolic` and `list-add` are one glyph on both renderers.

The SVG-source door stays open because it is what a consumer with their own icon set needs;
`registerIcon(name, svg)` additionally makes such a glyph resolvable BY NAME downstream.

Three answers, deliberately distinct:

| the caller passes | the widget draws |
|---|---|
| a name the subset carries | that glyph |
| a name it does not, or an unusable string | `image-missing` — visible, not silent |
| `''` / `null` | nothing, so each widget keeps its own absent-icon path |

The last row is libadwaita's behaviour for a NULL `icon-name`: an avatar falls back to the
person glyph, a status page collapses its image. Substituting `image-missing` there would take
that away.

## Why the subset is a subset, measured

Inlining everything `@gjsify/adwaita-icons` exports is **644 glyphs and 732 371 bytes of SVG
source (715.2 KiB)**. The compiled subset is **31 glyphs, 27 851 bytes (27.2 KiB)**, of which
six were already imported by a widget here for its own chrome — so the bundle grows by the
other **25 glyphs, 24 133 bytes (23.6 KiB), 3.3 % of the barrel**. Reproduce by summing the
template literals each module of `packages/web/adwaita-icons/*.ts` exports.

**An entry is paid for by every app**, and that is a chosen trade rather than an oversight: a
bundler cannot tree-shake individual properties out of an object literal, so the map is
all-or-nothing exactly as the web pillar's stylesheet is. It is why the membership rule is
enforced in BOTH directions.

**The membership rule:** every icon name a shipping NativeScript-facing surface in this
repository emits as a NAME, and nothing else. The port's own chrome glyphs are deliberately
NOT in it — a combo row's `pan-down`, a spin row's `value-increase`, the split-button arrow are
imported at their point of use, because no caller names them and an entry no caller can reach
is a byte bought for nobody. Seven entries exist only because a storybook control offers them,
which is the same trade `build-scss.mjs` records for five of its own.

`scripts/check-nativescript-icon-names.mjs` holds the rule over eight surfaces: the port, the
NS storybook renderer, the two shipping NS apps, the XML templates' one source, the
renderer-neutral names in `@gjsify/adwaita-core`, the story metas whose icon controls all three
renderers read, and the website's `nativescript` fences ONLY — a GJS pane on the same page
names icons the system theme resolves, and judging every slot against one subset is how the web
pillar's own incident shipped.

## The arm that exists because two renderers already got this wrong

Beyond "a name must resolve" and "an entry must be emitted", the gate holds a third thing the
web pillar does not: **a key's glyph must be the export the key DERIVES** (`list-add` →
`listAddSymbolic`, the icon generator's own rule).

The first two arms are blind to a key pointing at some OTHER icon — it resolves, it reports
available, and it draws the wrong picture. That is not hypothetical. The browser storybook drew
`view-grid` where its GTK twin drew `view-paged-symbolic`, under a comment blaming the icons
package for a glyph it exports. Putting the gallery's two panes side by side found the same
substitution twice more in this port's own snippets: `Adw.TabView` drawing `view-grid` for
`view-paged-symbolic`, and `Adw.InlineViewSwitcher` drawing `preferences-system` for
`emblem-system-symbolic`. All three now name what their GJS twin names.

The gate found a fourth on its first run, of the same family: the storybook's button-row story
mapped `edit-delete`, a name its own control does not offer, so picking "Trash" drew nothing at
all. Nothing could have found it before, because there was nothing to compare a name against.

## What the lookup replaced

Before it, four hand-rolled name-to-glyph maps lived in the port and seven more in the
NativeScript storybook showcase — one or two names each, none able to see the others, every one
of them written because the port could not resolve a name. `avatarIconSvg` mapped one absent
value onto one default glyph; `nsIconSvg` mapped the `image-missing` sentinel; `peekIconSvg`
mapped the password row's two canonical names; `buttonContentIconSvg` mapped the empty slot.
Eleven registries is what a missing mechanism looks like from the inside, and all eleven are
gone.

**The premise that kept them there was wrong in an instructive way.** Four widget headers, a
template generator, a gate's scope paragraph and ADR 0034 all said the same true thing —
NativeScript's `Image` decodes no SVG — and drew the wrong conclusion from it. The port already
rasterises the document itself (`icons.android.ts` walks the path data onto a `Bitmap` with
`androidx.core.graphics.PathParser`; `icons.ios.ts` replays it into a `UIBezierPath`), so the
RENDERER was never the obstacle. What was missing was the half in front of it: a name to look a
document up by. The port had a rasteriser and no theme.

## The platform variants are build-gated, and that is why

`icons.android.ts` and `icons.ios.ts` are the two rasterisers, resolved by the NS build's
`platformResolvePlugin`. `nativescript-platforms` conformance **fails the build if a declared
platform loses its variant AGAIN** — the word is load-bearing: it has happened, and the failure
mode is silent, because the base `icons.ts` returns `null` and a widget with no icon looks like
a widget whose caller passed none. iOS rasterising is UNVERIFIED ON DEVICE (#1051).

## Still open

- **The XML templates omit their icons.** Four entries in
  `scripts/adwaita-gallery-ns-templates.mjs` say why in prose — *"No `iconName`: it is an SVG
  source string"* — and that reason is now false: a name carries through an XML attribute
  untouched, because `setPropertyValue` ends in `instance[name] = value` for a plain accessor.
  Filling them in needs the on-device probe that inflates those trees through NativeScript's own
  `Builder` to be re-run.
- **`Adw.AboutDialog.applicationIcon` takes a text glyph**, not a name: it paints a `Label`, not
  a `GtkImage`, so a theme name there is widget work rather than a lookup.
- **`AdwPreferencesPage.iconName` is stored and never drawn**, which is why
  `status/open-todos.md` records its value kind as undetermined.
