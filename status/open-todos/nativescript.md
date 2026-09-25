<!-- Authored Open-TODO sections — area: NativeScript bridge.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### NativeScript `Gtk.Box` grants no spare space to an expanding child

`hexpand` / `vexpand` reach every NativeScript widget under GTK's names (`widget-layout.ts`,
ADR 0034 § Amendment 20) and are held and read back, but no parent in the port allocates by
them. The case a gallery Blueprint writes is a vertical `Gtk.Box` holding a `vexpand` stack or
tab view: GTK hands the box's spare height to that child, and the port's `GtkBox` is a
`StackLayout`, which measures every child at its natural size. The web grows it
(`gtk-box[orientation='vertical'] > [vexpand] { flex-grow: 1 }`). Closing it means a box that
can divide spare space — a `GridLayout` with a `*` track per expanding child and `auto`
elsewhere is GTK's rule exactly — and the same change would answer the `homogeneous` gap the
`gtk-box` coverage row declares.


### The NativeScript `xmlns` barrels cannot spell a window, so no shipped `.blp` builds there

Measured 2026-09-22 at `95198adaf6`: among the shipped templates whose projection declares no
loss, **not one** has every tag in `packages/nativescript-bridge/adwaita/src/namespace/{adw,gtk}.ts`.
They root at `AdwApplicationWindow` ×6, `AdwBin` ×2 and `GtkApplicationWindow` ×1, and the
barrels have a member for none of the three; the rest of the gap is `GtkScrolledWindow` ×2,
`GtkSeparator` ×1 and `GtkActionBar` ×1. ADR 0070 § How the numbers here were obtained carries
the denominator, dated — it is nine files now, not six, because ADR 0068 carried the style
classes and three more files went lossless. `elementFor` refuses a missing member by design, so
this is a clean refusal and not a wrong widget.

ADR 0070 wired `blueprintPlugin()` onto the `nativescript` target and retired the
"Blueprint is a GTK-specific UI DSL" comment, so the BUILD no longer stands between that port and
a `.blp`. What is left is widget coverage in the port, which is ADR 0034's ledger — the window
class first.


### `withSignals` shadows nothing in `@nativescript/core` today, and nothing holds "today"

`widgets/signals.ts` adds `connect` and `disconnect` to every `@gjsify/adwaita-nativescript`
widget (ADR 0034 § Amendment 14) on the measurement that no view base of
`@nativescript/core@9.1.0-alpha.11` declares either — `Observable`, `ViewBase`, `View`,
`LayoutBase` and their platform variants have none, the one `disconnect(` in the package
is `GesturesObserver`'s, and no runtime `.js` assigns the name. That is the same class of
hazard the `cssClasses` incident came from: `ViewBase`'s constructor assigns a member, a
widget shadows it, and the widget dies inside its own constructor.

The ambient slice `src/ns-core.d.ts` holds the hazard in ONE direction only. A member it
declares makes a shadowing widget fail `gjsify tsc`; a member the real package ADDS later
is a name it cannot declare, so a future core that grows `Observable.connect` would be
shadowed by the mixin with no type error anywhere in this repository, and the first place
it would show is a consumer's build against the real package. What would hold it: a step in
`tests/integration/nativescript` — the one venue with the real `@nativescript/core`
installed — that asserts the two names are absent from every base the widgets extend, and
fails the day one appears. Not built here, because that suite is a device-adjacent leg
nobody runs in the required job, and a guard that runs nowhere is prose.


### The theme-class gate counts a name only if it starts with `adw-`

`check-nativescript-theme-classes.mjs` holds every style class a NativeScript widget emits
against the stylesheet that must carry it, and its filter is one line:

    const isTracked = (name) => name.startsWith('adw-') || UNPREFIXED.has(name);

**Right today, and only because of a distinction ADR 0034 § Amendment 10 had to state
explicitly**: a widget is named after the library owning its GType, a style class after the
design system whose stylesheet carries it. Every class this port emits is Adwaita's — the five
widgets that took GIR names (`GtkButton`, `GtkDropDown`, `GtkEntry`, `GtkMenuButton`,
`GtkImage`) all still set `adw-*` classes, deliberately.

**What it cannot see** is the day that stops being true. A widget emitting a `gtk-`-prefixed
class would leave the gate's sight silently: not reported as unstyled, not reported at all —
the same shape as a seed that matches nothing (#1544), one file over. Measured while renaming
`AdwIcon`: moving its class to `gtk-image` produced *"listed, but no widget emits it any
more"* for the ledger entry and NOTHING for the new class, which is the asymmetry.

**Why it is not widened now.** A rule widened before it has a case to serve is a rule nobody
can check: with no `gtk-`-prefixed class in the tree, the widened filter and the current one
are indistinguishable on every input, and the vector that would separate them has to invent
the thing it tests. The trigger to act is the first widget that genuinely wants a GTK-named
class — at which point the filter becomes `startsWith('adw-') || startsWith('gtk-')` and the
ledger keys move with it.


### `Adw.Avatar:custom-image` has no NativeScript counterpart, and the blocker is the CLIP

`AdwAvatar` on `@gjsify/adwaita-nativescript` now carries four of its GType's five
writable properties — `text`, `size`, `showInitials` and `iconName`. The fifth,
`custom-image`, is not there, and the reason it is an entry rather than a fix is worth
stating precisely, because the property's own header comment used to give the wrong one
("the CSS-subset widget has no icon-theme lookup") for the two that WERE implementable.

The VALUE is not the obstacle. `Adw.Avatar:custom-image` is a `GdkPaintable`, and
NativeScript's honest counterpart is `ImageSource` (a decoded `android.graphics.Bitmap`
/ `UIImage`) or the `src` string an `Image` already accepts — the browser element next
door settled the same question by taking an image URL. The obstacle is that
`update_visibility` puts the image INSIDE a circle, and this port cannot show that a
NativeScript view clips a bitmap to one:

  · `packages/nativescript-bridge/AGENTS.md` records the measured fact that NS does not
    clip children to a parent's border-radius — which is why every row here is
    transparent and the `.boxed-list` card paints the rounded fill. So the avatar's own
    `GridLayout` radius will not clip a child `Image`.
  · An `Image` carrying its OWN `borderRadius` is a different question and the answer is
    per-platform. iOS sets `clipsToBounds = true` on every image
    (refs/nativescript/packages/core/ui/image/index.ios.ts:88#clipsToBounds), so a layer
    corner radius clips there. Android routes background *and* the four corner radii
    into one `org.nativescript.widgets.BorderDrawable.refresh(…)` call
    (refs/nativescript/packages/core/ui/styling/background.android.ts:79#borderDrawable.refresh),
    which is the BACKGROUND drawable — an `ImageView`'s own drawable is painted above it,
    and whether that one is clipped is Java this repo does not vendor.
  · A `background-image` on the avatar's GridLayout would go through that same
    `BorderDrawable` and might therefore be clipped for free. That is an inference from
    one call signature, not a measurement, and `background-size: cover` is a second
    unmeasured assumption on top of it.

So the honest state is: one of two plausible implementations, neither verified, on a
port whose iOS half is unverified on device at all (#1051). What closes this is a run,
not a design decision — set a square photo on an avatar under both spellings on an
Android emulator and an iOS device, and see which (if either) comes out round. Until
then a `customImage` setter would be a property that silently draws a square where GTK
draws a circle, which is the shape this repo treats as the defect rather than the
fallback.

Note for whoever picks it up: `avatarMode` in `@gjsify/adwaita-core` already returns
`'image'`, `avatarVisibilities` in `widgets/avatar-view.ts` already answers for it, and
`AdwAvatar._applyMode` passes a hardcoded `hasCustomImage: false` with a comment saying
so. The wiring is one property and one child view; only the clip is open. The vocabulary
ledger cannot hold this: `NS_PROPERTY_ALIGNMENT` measures properties the PORT has that
the GIR counterpart does not, so a GIR property the port LACKS is invisible to it and to
every other gate in the tree.


### Three NS widgets hand-roll a sheet lookup the tree already solved

`Dialogs.action()` returns the chosen STRING, so every NativeScript widget that
substitutes a sheet for a popover has to map that string back to an entry. The
tree has a correct answer for it and does not use it three times.

`widgets/split-button.ts` exports `menuSheetActions()` + `resolveMenuChoice()`:
the first seeds the used-label set with the dismiss text and appends zero-width
spaces until every action is distinct, so a second entry with the same label and
an entry literally called `Cancel` both stay addressable; the second returns `-1`
for a dismissal. Both are spec'd (`split-button.spec.ts:144-174`, incl. the
`Cancel` case). `adw-alert-dialog.ts` solves the same problem the other correct
way, delegating to core's `resolveLabel`.

`gtk-menu-button.ts:85`, `adw-combo-row.ts:132` and `gtk-drop-down.ts:116` each
call `labels.indexOf(chosen)` over the raw labels with a bare
`cancelButtonText: 'Cancel'` instead — the addressing core documents as wrong in
`SplitButtonState.activateMenuEntry` ("silently dispatches the first of two
identically named entries and cannot tell an entry called `Cancel` from a
dismissed sheet"). `adw-menu-button` also carries its own `entry.id ?? entry.label`
fallback, which the browser twin repeats at `gtk-menu-button.ts:229`.

Deferred rather than done here because the home is NOT the local helper: both
renderers need it, so `menuSheetActions`/`resolveMenuChoice` belong in
`@gjsify/adwaita-core` beside `parseMenuEntries`, with conformance vectors, and
the web copies of the id-fallback go at the same time. That is a widget-behaviour
change to four files across two renderers; it was found during a pass on the
widget-coverage READER, and landing it there would have moved the published
core-backed count for a reason that has nothing to do with how the count is read.

It does move that count when it lands: `split-button.ts` imports
`@gjsify/adwaita-core` for `splitButtonArrowIcon`, so `adw-menu-button` reaching
the shared helper gives it the value edge the matrix asks for — flipping its row
because it became true, not because a marker said so.


### Upstream PRs in flight (NativeScript) — track until merged

Two fixes contributed upstream so NS apps work without gjsify-side workarounds. **Both OPEN as of 2026-06-04.** Revisit when either merges + ships in a NativeScript release: drop the corresponding workaround, then bump the version floor / re-validate.

| PR | Fixes | Our interim workaround | Drop when merged + released |
|---|---|---|---|
| [NativeScript/NativeScript#11259](https://github.com/NativeScript/NativeScript/pull/11259) — `fix(vite): support Vite 8 / Rolldown` | `@nativescript/vite`'s function-replacement `resolve.alias` + `@rollup/plugin-commonjs` that Vite 8 / Rolldown reject | `@gjsify/nativescript-vite`'s `applyVite8Fixes()` drops both at compose time | When `@nativescript/vite` ships Vite-8 support, `applyVite8Fixes` can shrink to (or drop) the two fixes — gate on the `@nativescript/vite` version |
| [NativeScript/nativescript-cli#6056](https://github.com/NativeScript/nativescript-cli/pull/6056) — `fix(bundler): copy the vite bundle to native in non-watch builds` | NS CLI copies the Vite bundle into the APK only in watch mode; `ns build` / `ns run --justlaunch` leave `assets/app` empty → SBG fails | `tests/integration/nativescript/scripts/run-on-device.mjs` does `ns prepare` → manual copy → `gradle assembleDebug` | When the fixed NS CLI ships, the runner can use plain `ns build` / `ns run --justlaunch` again |

Check status: `gh pr view 11259 --repo NativeScript/NativeScript --json state` / `gh pr view 6056 --repo NativeScript/nativescript-cli --json state`. No CLA required on either repo; both are auto-reviewed by CodeRabbit — address only blocking findings.


### NativeScript apps that pull web-API third-party deps — eval-time global injection (Welle 5 follow-up)

On-device teapot re-validation confirmed the css-tree fix, but the teapot still does not render on NS V8: its third-party deps (`@nativescript/canvas-polyfill`, `@xmldom/xmldom`, `three`) instantiate web globals at module-evaluation time (`new TextEncoder()` / `new XMLHttpRequest()` / `new FileReader()` at top level) and NS V8 doesn't provide those globals that early. The same class as the `@gjsify/buffer` eager-`TextEncoder` bug, but in deps gjsify doesn't own. The gjsify-side fix is a composer feature: inject/seed the web-API globals (or hoist canvas-polyfill's registration) at the very top of the NS bundle, before any module evaluates — analogous to the GJS `process-stub` `renderChunk` prepend. Design open (which globals; seed-from-`@gjsify/web-*` vs hoist canvas-polyfill; `optimizeDeps`/`renderChunk` prepend). Until then, NS apps whose dependency graph instantiates web globals at eval time (canvas/WebGL/three.js stacks) build but crash on launch; headless logic packages run fine. Related open items:

- **NS CLI 9.0.6 Vite bundle-copy is watch-mode-only** — `compileWithoutWatch` never calls `copyViteBundleToNative`; the smoke runner works around it (manual copy after `ns prepare`); the real fix is the upstream NS-CLI PR above.
- **iOS smoke test** — only Android was validated on-device; the platform path is symmetric (`.ios` extensions, `__IOS__`/`__APPLE__` defines) but unproven; add an iOS build smoke test when a macOS runner is available.
- **Conditional-export precedence** — `resolve.conditions` keep upstream's `browser` active alongside `nativescript`; a package with divergent `browser` vs `nativescript` conditional exports may resolve its `browser` variant. Decide a policy (drop `browser` for NS, or document) + add a regression test.
- **Worker builds** — the upstream `worker` config is passed through verbatim; gjsify transforms are not propagated into `worker.plugins`. Validate + propagate when a worker-using NS showcase lands.
- **Full ownership (Level 3)** — the composer keeps `@nativescript/vite` as an optional peer. Owning the NS-runtime plugins outright remains the larger goal — gated on whether the peer proves a maintenance burden + the upstream NS-CLI pluggable-`bundler` PR.


### NativeScript pillar coverage (Welle 5+, parallel implementations)

The slot backfill (all 80 declarable packages), `@gjsify/native-fs-bridge`, the `@gjsify/crypto` NS entry and the on-device integration suite have landed. Remaining Wellen (each a separate PR/worktree):

- **Welle 5-D — `@gjsify/stream` + `@gjsify/http`-client** (M): client-side over NS' native `fetch()`; server-side (`createServer` etc.) throws ENOTSUP; `runtimes.nativescript: 'partial'`.
- **Welle 5-F — extend `tests/integration/nativescript/`** per pillar as 5-D lands (CI runner may need a privileged container for the NS emulator stack).
- **Welle 5-G — `gjsify create-app --template nativescript-*`** (M): mobile-app scaffold templates. Adwaita-feel-on-mobile is an open design question — could use NS' native UI with gjsify polyfills providing the data layer.


### NativeScript build-feature ownership — Level 3 (gjsify as a first-class NS production bundler)

Level 2 (platform file resolution + platform defines) is owned by gjsify. **Level 3 (north-star, L, multi-week):** make `gjsify build --app nativescript` (or the Vite preset) produce a standalone NS-loadable production bundle, replacing `@nativescript/{webpack,vite}` for the JS-bundling step. The NS-runtime subset still to replicate: main-entry + bundle-emit to NS's expected dist layout (≈150 LOC sans HMR), static-copy of `App_Resources`/fonts/assets, the `@NativeClass()` transform (≈43 LOC), optionally app-components/XML page registration (≈278 LOC — skippable for code-only canvas apps) + CSS/theme-core. HMR is the bulk of `@nativescript/vite`'s complexity and is NOT needed to ship (production-only target). **Hard blocker:** NS's CLI bundler dispatch is a hardcoded `webpack|rspack|vite` switch — `bundler: 'gjsify'` needs an upstream NS-CLI PR for a pluggable bundler, OR gjsify masquerades under the `vite` name (current Level-1 path). The spawn contract is discoverable (`node <bundler>/bin build --config=<path>`, `NATIVESCRIPT_BUNDLER_ENV` JSON env, dist copied into APK assets).


### The NativeScript theme ships almost none of libadwaita's label utilities

`scripts/check-nativescript-theme-classes.mjs` now reads the storybook showcase's views
and templates as well as the bridge's widgets, and it closed three `adw-`-prefixed gaps
(`.adw-card`, `.adw-action-buttons`) plus one unprefixed one it could already see
(`.dimmed`, which had only an ancestor-scoped rule). What it still cannot see is the rest
of the unprefixed half, and the same showcase is full of it: `carousel.ns.ts` builds each
page with `className = 'adw-card accent|success|warning'` and labels it `title-1`,
`bottom-sheet.ns.ts` uses `title-2` — and **not one of those five has a rule** in any of
the three stylesheets `app.css` imports, nor in the `@nativescript/theme` core sheet it
imports first. The pages render at body size in the default colour where the browser twin
sets `font-size:24pt;font-weight:800` and a 14% accent tint
(`carousel.web.ts:12-14,36`), inline, because the web storybook does not use the classes
either.

`bottom-sheet.ns.ts:43` is the one to read first, because it says the quiet part: "Match
the GTK `.title-2` typography (bold heading) — NS has no typography utility class, so a
plain bold Label stands in." There is no stand-in. The next three lines set `text` and
`className = 'title-2'` and nothing else, so the label is neither bold nor larger — a
comment describing a fallback that was never written.

Setting the two properties on the Label is NOT the fix, and this is the trap worth
writing down: NativeScript drops a CSS value for any property a widget set as a LOCAL one
(`properties/index.js:585-598`, the reason `status/nativescript-theme-classes.json`
exempts `adw-icon`), so a local `fontWeight` would permanently shadow the `.title-2` rule
this entry is asking for. The theme rule has to come first.

WHY THE GATE DOES NOT HOLD IT YET, measured rather than assumed. Its tracked set is
`adw-*` plus a named handful of unprefixed classes, deliberately: a bare-word heuristic
would sweep up every lowercase string in the tree. The obvious principled widening — take
the names from `refs/libadwaita/doc/style-classes.md`, which
`check-adwaita-style-classes.mjs` already reads — was tried and measured against the tree
as it stands: **53** documented classes, 15 emitted by the bridge or the showcase, **8
with no unconditional rule**. Four of the eight are noise: `.content`, `.inline` and
`.sidebar` are slot names and property values in `split-view-base.ts`,
`view-switcher-model.ts` and `adw-sidebar.ts` that happen to match a documented class
name, and `.circular` is the equality test `if (style === 'circular')` in
`button-styles.ns.ts:74`. A gate that accuses in four cases out of eight gets routed
around, so the widening waits for a reader that can tell a `className` assignment from
any other string.

That count is 53 and not 52 for a reason worth keeping: `style-classes.md` writes most
classes in backticks and exactly one — `.accent`, the colour-utility table at `:368` — in
`<tt>` tags. `check-adwaita-style-classes.mjs` read only backticks, so a DOCUMENTED
libadwaita style class was outside the gate whose whole job is that document, and its
ledger had no entry for it either. `.accent` has always been implemented on the web
(`scss/_labels.scss:53`); what was missing was anything that would notice if it stopped
being. Both are fixed. The lesson is the shape: a reader keyed on ONE spelling of an
upstream document is a reader with a hole the size of whatever that document spells
differently, and nothing points at the hole.


### The NativeScript list-model setter is held by core's vectors, not by a widget test

`AdwComboRow.model` and `GtkDropDown.model` on `@gjsify/adwaita-nativescript` run
`normalizeComboOptions`, so one authored model — bare strings included — moves
between the surfaces unchanged (ADR 0046 § 5). It fixed a real defect: the setter
took descriptors only, so `model = ['a', 'b']` stored strings and every label read
back `undefined`.

Nothing in that package asserts it. `drop-down.spec.ts` and `index.spec.ts` drive
`ComboState` directly, for the reason `drop-down.spec.ts`' own header gives: the
widget module cannot be imported there, because `GtkDropDown extends StackLayout`
evaluates the bare `@nativescript/core` specifier at module-eval, which is
unresolvable on GJS and on Node. `LIST_NORMALIZE_VECTORS` is driven through the
browser elements' real `model` property and through core, so the RULE is measured
twice — but the NativeScript widget's own door is measured by nothing, and this is
what a reader should know before treating that surface's normalisation as covered.

The same gap covers every other pure-delegation line in those two widget classes.
What closes it is whatever eventually lets a NativeScript widget module be
evaluated in the suite — the `ns-core.d.ts` ambient slice is the type-level half of
that problem and does not run anything.

