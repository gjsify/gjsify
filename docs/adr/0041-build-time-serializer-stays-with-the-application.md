# 41. A build-time serializer of a component tree into declarative UI files stays with the application that owns the content

- Status: **Proposed**
- Date: 2026-09-04
- Deciders: Pascal Garber
- Related: [ADR 0033 (templates preferred)](0033-declarative-templates-preferred.md), [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md), [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0003 (package tiering)](0003-package-tiering.md), [ADR 0015 (headless package contract)](0015-headless-package-contract.md)

## Context

### The question

Should gjsify offer build-time serialization of a component tree into declarative UI
files — GtkBuilder XML, NativeScript XML, HTML — beside the runtime element layer it
already has in `@gjsify/gtk-host`?

The question comes from one place. `JumpLink/Learn6502` carries `packages/learn`, which
turns two MDX files into three static artifacts, and a translation incident on 2026-09-03
put that package's build wiring under a light. The proposal was that the emitter belongs
in gjsify. This ADR tests that and answers **no**, with what happens instead and the two
conditions under which the answer changes.

### What the Learn6502 serializer is — measured

All numbers are from the checkout at `gjsify/easy6502` on 2026-09-03; the command that
produced each is named so the number can be re-derived rather than trusted.

**Size and shape** (`wc -l` over `packages/learn/tsx/**`): 2 147 lines of TSX/TS.

| part | lines | of which the `*-code` component |
|---|---|---|
| `components/gtk/` | 746 | 283 |
| `components/html/` | 614 | 278 |
| `components/nativescript/` | 555 | 287 |
| `index.tsx` + `utils.ts` + `enums/gtk.enums.ts` | 232 | — |

The three `*-code` components are **848 lines, 39.5 % of the package**, and every one
of them imports `@learn6502/examples` and emits the app's own `SourceView` widget
(`<object class="SourceView" id="sourceView0">`, with `code`, `language`, `readonly`,
`line-number-start` …). They are Learn6502, not a general capability. What remains as a
candidate for sharing is ~1 070 lines of label/box/list/heading mapping plus 232 shared.

**Content** (`grep -c` over `tutorial.mdx`, 825 lines / 34.8 KB): 34 headings, 52 fenced
code blocks, **0** images, **0** tables, **0** JSX components, **0** imports. The element
map in `gtk.components.tsx` has 19 keys; the content exercises a subset. The serializer
has never had to answer a question a plain markdown paragraph does not ask.

**Output** (`grep -o` over `dist/tutorial.ui`, 566 lines): 303 `GtkLabel`, 95 `GtkBox`,
26 `SourceView`. Distinct `<property name>` values: **24**, of which **14** are GTK
properties (`label`, `use-markup`, `wrap`, `halign`, `valign`, `xalign`, `hexpand`,
`hexpand-set`, `vexpand`, `vexpand-set`, `margin-top`, `margin-bottom`, `margin-start`,
`orientation`) and 10 are the `SourceView`'s own.

**Toolchain:** nano-jsx `renderSSR` under `@mdx-js/rollup`, run through `gjsify build
--app gjs --globals node` and `gjsify run`. The package declares `@gjsify/cli ^0.10.0`;
the installed CLI in that checkout is **0.16.3**, against gjsify `main` at 0.46.0.

**Churn** (`git log --oneline -- packages/learn`): 12 commits in the package's life, 3
touching `tsx/` since 2025. It is stable code.

**Consumers, and the test gap.** `app-gnome` imports `@learn6502/learn/dist/tutorial.ui`
as a `GObject.registerClass` `Template` (`src/mdx/tutorial-view.ts`; `MdxView extends
Adw.Bin` finds `sourceView<N>` ids by regex over the XML). `app-android` loads a copied
`app/mdx/tutorial.xml` through NativeScript's `Builder.load` and then localises each
`HtmlView` at runtime (`localize(htmlView.html)`). `app-web` imports
`dist/tutorial.html` as a fragment. **No test in the repository references any of the
three outputs** (`grep -rl` over `*.test.*`/`*.spec.*`: nothing). The `build:copy` step
that feeds Android is a `cp` in `package.json`.

### The internationalisation property — where it actually lives

`gtk-label.component.tsx` emits every prose block as

```xml
<property name="label" translatable="yes"
          comments="TRANSLATORS: MDX-derived text from packages/learn/tutorial.mdx">
```

so one markdown paragraph, inline markup included, is **one gettext msgid**. `xgettext`
scans the generated `.ui`; GtkBuilder does the lookup at load. There is no `_()` for
tutorial content anywhere in the application. In the committed catalog
(`eu.jumplink.Learn6502.pot`, 457 msgids) **165 are MDX-derived — 36 %** (`grep -c
'translatable="yes"'` over both `.ui` files: 141 + 24).

The measurement that shapes the decision: **the msgid is not a property of the `.ui`
file.** It is `clearExtraSpaces(renderSSR(children))` — a function of the MDX paragraph
and the inline element mapping (`em`→`<i>`, `strong`→`<b>`, `code`→`<tt>`,
`sub`/`sup`→`<small>`), computed in `utils.ts` and identical in `GtkLabel.render()` and
`NsHtmlView.render()`. Checked by sampling three msgids out of `tutorial.ui` and grepping
`tutorial.ns.xml`: **3 of 3 byte-identical.** That is why one `.po` set serves GTK (via
`msgfmt`) and Android (via `po2json` + runtime `localize(html)`) — Android never reads a
`translatable` attribute; it looks the string up itself. The web target has no
internationalisation at all (`grep -rl gettext\|i18n packages/app-web/src`: nothing).

So the serializer's valuable property is **"one msgid per paragraph, shared across
targets"**, and it is produced by the MDX→inline-markup step. GtkBuilder's
`translatable="yes"` is the cheapest *consumer* of that property on one target, not its
source.

### What gjsify has — measured

- `@gjsify/gtk-host` (`packages/framework/gtk-host`, 28 084 lines with specs, 20 320
  without): `createElement` / `insert` / `materialize` over real widgets at runtime. It
  contains **no** serializer to GtkBuilder XML (`grep -rl GtkBuilder\|serializ\|toXml
  src`: only comments naming the XML key). Tier 3, published at 0.45.0.
- gjsify does already emit text from a tree, twice, in `scripts/`:
  `adwaita-gallery-trees.mjs` + `generate-adwaita-framework-snippets.mjs` write Solid, Vue
  and React source snippets from one host-vocabulary tree, and
  `adwaita-gallery-ns-templates.mjs` is a deliberately **second** source for the
  NativeScript XML, because translating one toolkit's vocabulary into another's needs the
  alias table ADR 0029 § 4 refuses. Both are documentation tooling, not packages; neither
  emits a translatable artifact.
- `@gjsify/vite-plugin-gettext` owns `xgettext`, `msgfmt` and `po2json`. Nothing in the
  repository extracts strings from a component tree; the two places that reason about
  user-visible text are lint rules (`no-literal-widget-label`,
  `prefer-blueprint-template`), and their premise is the same one this ADR keeps: a string
  is translatable only if `xgettext` can see it, either as `translatable` in a template or
  as `_()` in code.
- `@gjsify/stories` and the storybook renderers carry story metadata, not prose content.
  There is no markdown or MDX pipeline in any published package (`grep -rn nano-jsx\|
  @mdx-js\|renderSSR packages/framework packages/web`: nothing).

### How the question arrived — the empty-glob incident

`packages/translations/build.js` lists `../learn/dist/**/*.ui` among its `xgettext`
sources. Built in the wrong order the pattern matched nothing, the `ui` group did not
exist, and — as recorded in the header of the spec now sitting in gjsify — 902 lines left
the POT and ~1 573 left each of 16 catalogs, at exit 0. It was caught by reading the diff.

Two things about that trap were asserted and both are wrong when measured:

1. *"Nothing declares the dependency."* `@learn6502/translations/package.json` declares
   `"@learn6502/learn": "^0.7.0"` under `dependencies`. `gjsify workspace` has
   `--with-dependencies` / `-t` (`packages/infra/cli/src/commands/workspace.ts`), which
   pre-builds transitive workspace dependencies in topological order before the target
   script; `gjsify foreach -t` does the same across the tree. The declaration exists and
   the tool that honours it exists. The script that runs `xgettext` is invoked without
   `-t`, and CI (`ci.yml`) runs only `translations check`, never `translations build`, so
   nothing exercised the order.
2. *"The split across repos is why the trap exists."* Moving the emitter into gjsify would
   not move the **content**; `tutorial.mdx` and the `dist/*.ui` derived from it would still
   be produced by a Learn6502 build step, and `xgettext` would still read a sibling's build
   artifact. The ordering question is identical on either side of the boundary.

The fix that does address it is at the core and in flight: the gjsify checkout is on
`fix/xgettext-catalog-guards` with an untracked `xgettext.spec.ts` whose cases are *"fails
on a pattern that matches no files"* and *"refuses to prune catalogs a collapsed POT would
empty"*. At the time of writing the spec exists and `xgettext.ts` is unchanged, so this is
work in progress, not a landed fact. Learn6502 PR #176 (the catalog validator) is open,
not merged.

### The four arguments, tested

**1. "The widget knowledge exists twice."** Counted with a script over
`gtk-host/src/generated/props.ts` against the four `propertyNames` arrays in the
serializer:

| list | serializer | gtk-host (own, writable) | overlap | serializer-only |
|---|---|---|---|---|
| `GtkWidget` | 34 | 30 | 29 | `has-default`, `has-focus`, `parent`, `root`, `scale-factor` |
| `GtkLabel` | 20 | 19 | 19 | `mnemonic-keyval` |
| `GtkBox` | 4 | 4 | 4 | — |
| `GtkOrientable` | 1 | 1 | 1 | — |

59 hand-typed names, 53 shared. The six serializer-only names are all **read-only** in
the GIR — gtk-host excludes them by construction; the serializer would emit them and
GtkBuilder would refuse the file at load. That is a real defect in the hand list, and it
has never fired, because the MDX component set uses **14** of the 59. The duplication is
real; its cost at this content and this churn rounds to zero. It is also the wrong shape
to fix by moving code: the list is a runtime allow-list in a component that also carries
`SourceView`. If it is worth removing, the cheap removal is a compile-time `Pick<>` over
gtk-host's `GtkLabelProps` — which needs Learn6502 on a gjsify that ships gtk-host
(0.4x, against an installed 0.16.3), a version jump the serializer alone does not justify.

**2. "The i18n pipeline is split across repos."** Emitting is in Learn6502, extracting
and compiling in gjsify, validating (PR #176) in Learn6502. Tested above: the split is
not what created the trap and moving the emitter would not close it. What closes it is a
plugin that refuses to run on an empty pattern (gjsify, in flight) and a build invocation
that pre-builds its declared dependency (`-t`, exists). The validator in PR #176 is about
`.po` **content** (markup parses, `<tt>` survives) and reads only catalogs; it belongs
with the catalogs.

**3. "Rendering at runtime would lose one-msgid-per-paragraph."** False, by the
measurement in § *The internationalisation property*: the msgid is derived before any
target is chosen, and the Android target already performs a runtime lookup on exactly that
string. A runtime renderer on gtk-host would keep the property if the build kept
**extracting** — a generated artifact `xgettext` can read (a `.ui`, or a generated `.ts`
of `_("…")` per paragraph) — and called `Gettext.gettext(msgid)` once per block at render
time. The msgid derivation would then have to live in one place both the extractor and
the renderer import, which is a headless function of ~60 lines, not a serializer. What
gjsify does not have is that renderer: no package renders markdown onto gtk-host today.
The design space for one was surveyed (label + Pango markup, `GtkTextBuffer` +
`insert_markup`, or hybrid block-widgets/inline-Pango — the shapes gnome-software,
`AdwAboutDialog` and Fractal/Tuba use); those notes are working notes, not repository
facts, and are marked here as inference. A runtime design is possible; it is a different
project from the one proposed.

**4. "This is a niche of one."** Checked every consumer in the workspace for markdown or
MDX UI content and for translatable templates:

| consumer | `.blp` files | `_("…")` in `.blp` | markdown/MDX UI content |
|---|---|---|---|
| `pixel-rpg/map-editor` | 0 | 0 | none |
| `buchhaltung/app` | 15 | 0 | none (the only `markdown` hit is LLM output handling) |
| `bauplaner` | 0 | 0 | none |
| `troedler/app` | 0 | 0 | none |
| `postbote` (`projects/mail/app`) | 0 | 0 | none |
| `templates/*` in gjsify | — | — | none |

Nobody else has long-form authored content in a GTK app, and nobody else marks a single
string translatable in a template. The second consumer ADR 0003 requires for promotion
out of Tier 3 does not exist, and a package written for one consumer is the shape ADR 0003
§ 3 puts at Tier 3 "no matter how promising" — with nothing to promote it.

### What ADR 0033 says about this

ADR 0033 prefers a template file for the tree and TypeScript for the behaviour, and it
names the honest imperative cases: *"a tree whose shape is computed, a widget built from
data."* A generated `.ui` sits between the two: the tree IS computed from data, and it is
also a template, registered through `GObject.registerClass({ Template })` with only
behaviour in `MdxView`. Nothing in 0033 objects to a generated template; 0033 did not
contemplate one. This ADR records that a template generated by the owner of the content is
an instance of 0033's preferred form, not an exception to it — and that the generator is
part of the content's build, which is the sentence the rest of this ADR rests on.

ADR 0034 § 8 says the repository's answer to the translator problem is *"write the tree
ONCE in the vocabulary that runs and emit the dialects."* Learn6502 does that — one MDX,
three dialects — and 0034 also measured why the dialects cannot be a mechanical
translation of each other (12 attribute *semantics* diverge, none a spelling). The
Learn6502 emitters diverge in the same way: the NativeScript target packs a whole paragraph
into an `HtmlView`'s `html` attribute and localises at runtime, the GTK target into a
Pango-markup label with `translatable`, the web target keeps real nested HTML. Three
targets, three semantics, one source. That is the shape 0034 endorses, and it is already
where 0034 wants it: in the hands of the source's owner.

## Decision

**gjsify does not take on build-time serialization of a component tree into declarative
UI files.** No `@gjsify/ui-serializer`, no MDX toolchain, no nano-jsx dependency. The
Learn6502 emitter stays in `JumpLink/Learn6502`, where the content, the `SourceView`, the
catalogs and all three consumers already are.

Four reasons, each resting on a measurement above rather than on a preference:

1. The property that makes the serializer worth having — one shared msgid per paragraph —
   is produced by a 60-line inline-markup step, not by GtkBuilder XML emission. Moving
   the emitter moves the wrong 2 000 lines.
2. The ordering trap that raised the question is not a repository-boundary problem. The
   dependency is declared, the tool that honours it exists, and the guard that makes the
   failure loud is being built at the core, in the plugin that owns `xgettext`.
3. The duplicated widget knowledge is 53 names of which 14 are used, in code that changed
   three times since 2025. Its correct removal is a type import, not a package move.
4. There is one consumer, 39.5 % of the code is that consumer's `SourceView`, and no
   second consumer exists in the workspace or is in sight.

**What gjsify owns instead**, all of it already the plugin's job:

- `@gjsify/vite-plugin-gettext`'s `xgettextPlugin` **fails on a `sources` pattern that
  matches no file** and **refuses an `autoUpdatePo` merge that would empty catalogs**. Both
  are the cases in the in-flight spec; landing them is the whole of gjsify's answer to the
  incident. A plugin that cannot see its input must say so, not report success.
- The plugin's README documents that a `sources` entry pointing at a sibling package's
  build artifact is a **declared dependency to be built first**, and names
  `gjsify workspace -t` as the way to do that. That sentence is the one that was missing.

**What Learn6502 does** (recorded here because the ADR is about a boundary, and the other
side of the boundary has obligations too — tracked in Learn6502, not in gjsify's
`open-todos`):

- Invoke `translations build` with `-t`, or make `learn build` an explicit prerequisite in
  the script, so the order is written down where it is executed.
- Add the test that does not exist: a golden-output test over `dist/tutorial.ui`,
  `dist/tutorial.ns.xml` and `dist/tutorial.html`, plus one assertion that the msgid set of
  the `.ui` equals the `html="…"` set of the `.ns.xml`. That test is what any future move
  of this code would need first, and it protects three consumers today.
- Optionally, trim the six read-only names out of the property lists or replace the lists
  with a `Pick<>` over gtk-host's generated props when Learn6502 next bumps gjsify. Not
  before: the bump is 0.16 → 0.4x and the serializer is not the reason to make it.

**What reopens this decision** — two conditions, either sufficient:

1. **A second consumer** in the ecosystem ships translatable long-form content in a GTK or
   NativeScript app from a markdown source. At that point the shared part is *not* the
   serializer but the headless MDX→block/inline model whose inline serialization defines
   the msgid; it would be declared `gjsify.headless: true` (ADR 0015), sit under
   `packages/framework/` or `packages/web/` as ADR 0004 places behaviour cores, and the
   three Learn6502 emitters would become adapters over it — the `StoryViewBase<TNode>`
   seam pattern ADR 0004 already names. That is a new ADR, and it starts at Tier 3.
2. **A runtime markdown renderer on gtk-host lands** in gjsify. The same headless model
   is then the piece both the runtime renderer and any build-time extractor import, and
   the question becomes whether Learn6502's GTK target moves to runtime rendering (which
   would give it selectable text and a real tree for the bidi handling that is regex
   surgery today — inferred from the RTL fixes in `mdx-view.ts`, not measured). The web and
   Android targets are unaffected either way.

Until one of those holds, a gjsify package here would be a second execution model with
one user, and ADR 0003 already says where that lands and why it does not leave.

## Consequences

- gjsify keeps one execution model for UI trees — runtime materialisation — and one
  place where translatable text is reasoned about: `xgettext` over templates and `_()`.
  No MDX, nano-jsx or SSR dependency enters the release train.
- The Learn6502 serializer stays a private package with a private toolchain, and its
  property lists stay hand-typed. The cost of that is measured at 6 unused read-only
  names and 3 commits since 2025; it is recorded so it is not rediscovered as "drift".
- The i18n pipeline stays split: emit in Learn6502, extract/compile in gjsify, validate
  `.po` content in Learn6502. The split is by ownership of the data each step reads, and
  after the plugin guard lands an empty input is loud on either side.
- The three consumers of `dist/*` are untouched; nothing migrates and no migration risk is
  taken. The absence of a test over those outputs is a Learn6502 gap that this decision
  neither creates nor closes, and it is named above so it does not stay invisible.
- A future markdown-on-gtk-host track inherits a finding it would otherwise have to
  re-measure: the msgid derivation is target-neutral, and it is the one piece that must be
  written once. Learn6502's `utils.ts` + the inline mapping is the reference.
- The rejected alternative is recorded: a `@gjsify/ui-serializer` at Tier 3 with
  Learn6502 as sole consumer, carrying nano-jsx and `@mdx-js/rollup`, whose GTK half
  would duplicate the vocabulary gtk-host already generates and whose `SourceView` half
  could not move at all. Unblocker: condition 1 or 2 above.

## Implementation

Since the decision is a refusal, the implementation is the set of things that make the
refusal safe, in the order they should land.

1. **gjsify — land the `xgettext` guards.** Finish `fix/xgettext-catalog-guards`:
   `xgettextPlugin.buildStart` throws when any `sources` pattern matches zero files, and
   `autoUpdatePo` refuses a merge that would drop entries a collapsed POT no longer
   carries. The spec's own entry counting stays independent of the implementation's
   counter, as its header requires. This is the only code change in gjsify.
2. **gjsify — one paragraph in `packages/infra/vite-plugin-gettext/README.md`:** a
   `sources` entry into another package's `dist/` is a build-order dependency; declare it
   in `package.json` and run with `gjsify workspace -t`. Cite the 902-line incident in one
   sentence so the rule keeps its reason.
3. **Learn6502 — order and test.** `-t` on the translations build; a golden test over the
   three outputs and the msgid-set equality between `.ui` and `.ns.xml`; run
   `translations build` in CI in a mode that fails on a changed POT, so the extraction path
   is exercised where the check path already is. (Today `ci.yml` runs `check` at line 93
   and `learn build` at line 103, and `build` never.)
4. **No package, no move, no `open-todos` entry in gjsify** beyond step 1's PR. The
   reopening conditions are the tracking mechanism: a second consumer or a runtime renderer
   is a visible event, not a date.

### What this ADR could not determine from the code

- Whether the empty-glob incident is the only silent-failure path in the catalog
  pipeline. `po2json` and `gettextPlugin` were not audited for the same class; the spec in
  flight covers `xgettext` only.
- Whether a runtime markdown renderer on gtk-host is wanted at all. The survey of GTK
  markdown architectures exists as working notes, not as repository status, and no issue
  tracks it (`gh issue list --search markdown` on `gjsify/gjsify`: two unrelated hits).
- The exact set of MDX elements the content uses. The map has 19 keys; the outputs show
  headings, paragraphs, ordered/unordered lists, inline `em`/`strong`/`code`/`a`, and
  fenced code; tables and images are 0 (measured). Sub/sup are mapped but their use was
  not counted.
- Whether Learn6502's `^0.10.0` declaration against an installed 0.16.3 is deliberate; it
  affects only the cost of the optional `Pick<>` cleanup, not the decision.
