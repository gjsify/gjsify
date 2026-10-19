<!-- Authored Open-TODO sections — area: adwaita-core (shared headless behaviour).
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `SharedTreeNode.slot` is carried by three restatements and read by no renderer

Measured 2026-09-22 at `95198adaf6`, on the working checkout. All three ADR 0051 tree builders
read `tag`, `props` and `children` and nothing else:

    packages/framework/gtk-host/src/conformance/shared-tree-builder.ts   createElement/materialize/insert
    packages/nativescript-bridge/adwaita/src/builder/index.ts            elementFor + _addChildFromBuilder
    packages/web/adwaita-web/src/shared-tree-builder.ts                  createElement/setAttribute/append

Nothing could see it, because ADR 0051's corpus — the only source of shared trees there was —
authors **zero** `slot`s across its seven blocks. ADR 0053's `.blp` projection is the first source
that authors any, and `showcases/gtk/effect-adw-services/src/window.blp` authors four of them
over fourteen nodes.

WHAT IT COSTS, measured on `adwaita-web` in a real browser
(`packages/web/adwaita-web/src/blueprint-tree.spec.ts`, two `it.failing` cases): the header bar
authored `[top]` lands in `adw-toolbar-view-content` rather than the top bar, and the
`title-widget:` window title then reaches `adw-header-bar` as a plain child and is DISCARDED by
the build that derives a title element of its own. Both of its `_()` captions are absent from the
rendered document — a caption that looks finished and is not there, which is ADR 0033's own reason
for preferring a declarative template.

WHY IT IS NOT A ONE-LINE FIX. The names differ: `content:` / `[top]` / `title-widget:` are
GtkBuilder's, and this renderer's are the unnamed slot, `top` and `center`. A table inside one
renderer is the per-surface translator ADR 0051 § Alternatives rejected refused on a measurement.
The shape that would be right is a `slotOf(tag, slot)` beside `hostTagOf`/`attributeOf` in
`@gjsify/adwaita-core/tags` — shared, gated by `check-tag-case-rules.mjs`'s mechanism, read by all
three builders — and it is a vocabulary decision with its own evidence to bring (ADR 0034 owns the
vocabulary; ADR 0070 § 7 names the gap and says why it did not take it).


### The swipe settle drops its velocity, so a flick and a slow drag ease alike

Upstream a released swipe does not scroll — it SPRINGS. `end_swipe_cb` calls
`scroll_to (self, child, velocity)`, which sets the target on an
`AdwSpringAnimation` and then
`adw_spring_animation_set_initial_velocity (…, velocity)`
(`adw-carousel.c:379-397`). So the finger's speed carries THROUGH the settle: a
flick keeps its momentum into the next page, a slow drag eases in, and both use
the same spring rather than the same duration.

The web settle is `scrollTo({ behavior: 'smooth' })`, whose curve and duration are
the user agent's and take no initial velocity. `elements/swipe-drag.ts` hands
`onEnd` the velocity already and `<adw-carousel>`'s handler documents that it
ignores it, so the seam is in place and the number is not lost — what is missing
is something to spend it on.

This is a consequence of a decision the core already records rather than a new
gap: `CAROUSEL_SETTLE_EPSILON`'s comment says the renderers let the PLATFORM
scroll (CSS scroll-snap, a NativeScript `ScrollView`) because C knows a scroll
finished from its own spring and a platform scroller has only an offset. Closing
it means porting `AdwSpringAnimation` — damping ratio, mass, stiffness, epsilon,
and its `estimate_duration` — and driving `scrollLeft` from a rAF loop instead of
handing the browser a target. That buys velocity continuity and costs the
platform's own scroll animation, including whatever it does about reduced motion.
Worth a measurement of the two side by side before it is worth the port.


### adwaita-core modules with no conformance vector table

`breakpoint.ts`, `color-scheme.ts`, `scrolling.ts`, `shortcut-format.ts`,
`source.ts`, `swipe.ts` and
`toast.ts` export shared behaviour and are covered by nothing in
`@gjsify/adwaita-core/conformance` — no vector table names them, and no
conformance file imports them. Three of them are what `packages/web/AGENTS.md`
advertises as the core's flagship shared behaviour ("Breakpoints
(grammar/parser/evaluator + transition-only `AdwBreakpoint`), color-scheme
observable, toast queue").

`source.ts` is the 6502 tokenizer, syntax palette and gutter formatters moved
out of `@gjsify/adwaita-web/source-view` so a second renderer could reach them
without pulling in CodeMirror. Today exactly one renderer does —
`adwaita-web`'s `source-view/asm6502.ts` and `theme.ts` import it for value —
and the GNOME native arm inherits the system Adwaita scheme instead of
consuming the palette table at all, so a vector table now would assert
adwaita-web's own derivation against itself. It earns one the moment a second
renderer needs the same tokenizer or palette.

`swipe.ts` is the newest and the one with the clearest trigger: it is
`AdwSwipeTracker`'s velocity, projection and snap-point choice, and exactly ONE
renderer drives it today (`adwaita-web`, through `elements/swipe-drag.ts`). A
table now would be the derivation asserted against itself, which is the state
this gate exists to stop counting as coverage. It earns one the moment a second
renderer grows a swipe — and three widgets upstream already want the same
tracker (`adw-bottom-sheet.c`, `adw-navigation-view.c`,
`adw-overlay-split-view.c`), whose web ports currently take `to` as an INPUT
(`resolveSwipeRelease` in `split-view.ts`) with nothing in the tree computing it.

`shortcut-format.ts` is two formatters, and only half of it is actually
untabled. `formatAcceleratorLabel` is a thin wrapper over `shortcut-label.ts`'s
`shortcutKeycaps`, so a vector table over IT would assert the same derivation
`SHORTCUT_LABEL_VECTORS` already tables, under a second name — that half is
driven, by `adwaita-web`'s `<adw-shortcut-label>`, already. `formatManifestShortcut`
is the genuinely untabled half: it parses a WebExtension manifest shortcut string
(`"Alt+Shift+B"`, `"MacCtrl+Shift+B"`) into the platform's own glyphs, a grammar no
libadwaita widget speaks and no renderer under `packages/web` or
`packages/nativescript-bridge` has a shortcut string to run it against — the one
consumer that does, the `beifahrer` browser extension, is a separate repo. It
earns a table the day a renderer inside THIS repo needs to show a manifest-style
shortcut rather than a GTK accelerator.

They were invisible rather than under-covered: `check-adwaita-conformance-drivers.mjs`
is keyed by TABLE, so it reported "156 vector tables, every one driven or
explained" over a set none of these four is in. The gate now carries a
module-keyed arm and these four are its declared exceptions
(`MODULE_REASONS`), which is what makes them countable.

Each needs its own vectors before a renderer can be held to it, and each is a
different shape of work: the breakpoint grammar wants a parse/evaluate table
against `refs/libadwaita/src/adw-breakpoint.c`; scrolling wants the undershoot
and overshoot arithmetic; the toast queue wants a scheduler seam both renderers
already have. `color-scheme` is entangled with the divergence below and should be
vectored after it is decided, not before.

The heading carries no count on purpose. It named "Four" while four
`MODULE_REASONS` entries matched it as a literal string, so closing one gap
would have made the heading false and correcting it would have required editing
`scripts/check-adwaita-conformance-drivers.mjs` in the same change — a live
count, load-bearing inside a required check.


### adwaita-core modules whose only vector table is core-only

`easing.ts`, `glib.ts` and `length-unit.ts` DO have vectors — respectively
`SPINNER_ARC_PHASE_VECTORS`, `GLIB_CLAMP_VECTORS` and `ADW_LENGTH_UNIT_VECTORS`
— but every one of those tables is itself `CORE-ONLY:`, so no renderer suite is
held to any of the three modules. `length-unit.ts` was worse than invisible: the
module arm counted it covered because `conformance/split-view.ts` carries
`import type { AdwLengthUnit } from '../length-unit.js'`, a type-only import
that borrows a name for a field and proves nothing about vectors.

Not the same gap as the four above, and it should not be filed under their
heading: those modules have no table to drive, these have one nobody drives.
`glibClamp` is the sharpest case — `gtk-progress-bar.ts` calls it directly in
the browser, so the seam exists; what is missing is a spec row that varies the
bounds far enough to tell `CLAMP` from `Math.min`/`Math.max`. The
`resolveNavigationSidebarWidth` path already does that through
`SIDEBAR_WIDTH_VECTORS`, which is why `GLIB_CLAMP_VECTORS`' own exemption is a
chain rather than a gap; the module is still held to nothing under its own name.

`engine.ts` joins them for a different reason, and it may be a permanent one.
Its CONTRACT is tabled and well driven — `GOBJECT_VECTORS` runs against the
pure-JS engine as the core's own subject and against the real-Gio engine as
`@gjsify/adwaita-gobject-native`'s — but its process-global opt-in SLOT
(write-once, freeze on first read) cannot be driven by a renderer suite: a suite
that registered an engine would pick the engine for every other suite in the
same run. `engine-slot.spec.ts` holds it in core, and ADR 0105 stage 4 measured
the slot on a device instead. What would retire this entry is a per-call
injection point beside the global slot, which no consumer has needed yet.


### A table can be "driven" while the rows that matter are skipped

`consumersUnder()` counts a table driven when a renderer's `*.spec.ts` names it
outside a comment. That cannot distinguish iterating the table from importing it
and filtering the interesting rows away, and six tables are only ever referenced
through a `.filter(` today: `ABOUT_DIALOG_DETAILS_VECTORS`,
`ABOUT_DIALOG_SUPPORT_VECTORS`, `ABOUT_DIALOG_CREDITS_LEGAL_VECTORS`,
`BUTTON_STYLE_CLASS_VECTORS`, `CAROUSEL_PAGE_ALLOCATION_VECTORS` and
`CLAMP_ALLOCATE_VECTORS`. Both renderer suites filter `CLAMP_ALLOCATE_VECTORS`
to `params.childMin === 0`, and three `CLAMP_*` tables are exempted as an
internal step of the pipeline it composes — a chain that does not carry the
non-zero-`childMin` rows. Two of the three now say so in their own reason
(`CLAMP_THRESHOLD_VECTORS`, three rows; `CLAMP_CHILD_SIZE_VECTORS`, one);
`CLAMP_SIZE_FROM_CHILD_VECTORS` needs nothing, every row of it runs at
`childMin: 0`. `adw-about-dialog.spec.ts` does the same thing with a `continue`
guard rather than a filter, which no textual rule sees at all — that is what put
the `g_strsplit ("")` translator-credits trap behind a false chain, now re-filed
as a GAP.

The measurable half (`X_VECTORS.filter(`) is about six lines of gate. It is
deliberately NOT implemented yet, because it catches the filter form and not the
`continue` form that motivated the finding, and a rule that covers two of three
shapes of a class reads as covering the class. Closing this means deciding per
chain whether the conceded rows matter, then either widening the specs or
narrowing the reasons to the rows they really carry — reason work, not gate work.



### A portable `gi://GObject` subset on the browser and NativeScript needs its ADR

`GObject.registerClass` is what every Learn6502 component class calls, and neither
`@gjsify/adwaita-web` nor `@gjsify/adwaita-nativescript` answers `gi://GObject`
(`packages/infra/resolve-npm/lib/gi-renderers.mjs` has no row for it), so the same component class
cannot yet run on all three targets. The ADR decides the subset and where it lives. Candidate home:
`adwaita-core`, so both ports share one implementation. Scope: `registerClass` with `GTypeName`,
`Template`, `InternalChildren`, `Properties` and `Signals`; `notify::<property>`; and
`bind_property` with `BIDIRECTIONAL`, `INVERT_BOOLEAN` and `SYNC_CREATE`. The bound on the scope is
`node scripts/report-target-gap.mjs <project-dir>`: a member it does not list among the value uses
is not in the subset, and one used only as a type needs nothing from a renderer.
The ADR also decides whether `registerTemplateClass` (ADR 0093 § 2) becomes a detail of
`registerClass`, so an application registers a class once.


### The portable `gi://GObject` subset is not implemented

Follows the ADR above. Vectors for the subset in `adwaita-core/conformance`, driven by both ports;
a `gi://GObject` row in `GI_RENDERERS`; an arm in `tests/e2e/gi-renderer-arms` that registers a
class with a template and binds a property through `--gi-renderer`. The vectors come first: an
implementation on one port with no vector is how the two ports diverged before.


### Platform members still missing for Learn6502 (gap report, `packages/app-gnome`)

Done on both ports: `Gio.Settings`, `Adw.ColorScheme`, `Gtk.CssProvider`/`StyleContext`/`Settings`/
`IconTheme`/`EventControllerKey`, `Gtk.show_uri`, `Gdk.KEY_*`, web `Gtk.License`. Open:

- Browser refuses `layout` (layout-manager placement). `GtkStackPage` (a `<gtk-stack-page>` record
  the stack adopts) and `sibling-object` (`buildWithSiblings`) are done on both ports.
- Conformance vectors for the platform slice do not yet run against real `gi://` under GJS.
- `keyvalOfKey` ignores Shift, so an uppercase key reports the lower-case keysym.

### The `GLib.Variant` subset of ADR 0118 is not implemented

ADR 0118 (Accepted 2026-10-18): `glib-variant.ts` in `adwaita-core` for `b i u d s` and arrays of
them, exported as `GLib.Variant` from both ports; `Gio.Settings` `get_value`/`set_value` and array
key types in `@gjsify/app-settings`, stored as GVariant text. `VARIANT_VECTORS` against GJS come
first. First consumer: Learn6502 `support-prompt-years` (`type="ai"`), unpersisted on web/Android.

### GTK CSS from a `CssProvider` does not apply on the web (ADR 0119)

ADR 0119 (Proposed 2026-10-19): `load_from_string` hands GTK CSS to the web `<style>` and to
NativeScript's `addCss` verbatim, so node selectors (`checkbutton.primary radio`, `:checked`)
match nothing; Learn6502's colour swatches render as grey radios on the web. Planned:
`GTK_CSS_VECTORS` against GJS first, then `adwaita-core/src/gtk-css/` (parser, node tables,
web emitter), cascade layers per priority with the skin at `gtk-p0200`, nesting lowered for
`--app browser`. NativeScript is a second stage after `var()` is measured there.

### The file chooser has no iOS picker and no on-device Android run

ADR 0100 decides Android's Storage Access Framework only. `file-chooser-source.ios.ts` rejects, so
`Gtk.FileDialog.open`/`save` answer `Gtk.DialogError.FAILED` on iOS; `UIDocumentPickerViewController`
is the counterpart and needs its own decision. The Android door (`file-chooser-source.android.ts`)
is covered by the intent-mapping specs and the `gi-renderer-arms` arm with a scripted driver, but
no run has gone through a real `startActivityForResult` on a device or emulator yet.

### Real GObject IS the Android default — the gates held, the flip shipped

[ADR 0110](../../docs/adr/0110-real-gobject-becomes-the-android-default-and-the-subset-stays-tested-there.md)
amends ADR 0105: the real engine is the NativeScript Android default since 2026-10-15, the pure-JS
subset stays (browser, iOS) and stays tested on Android. All four steps are done; what is left is
listed under step 4. The record, in order:

1. ~~Finish ADR 0105 stage 2 and time per-instance construction cost.~~ **Measured**
   ([report](../../docs/reports/2026-10-15-adr-0110-gates.md)): construction is free (lazy twin,
   plain `READWRITE` properties), use is not — first read ~5x/~8x, `set`/`notify` ~45x/~99x, emit
   ~24x/~20–45x (host/emulator). **Then optimized**
   ([report](../../docs/reports/2026-10-15-node-gi-set-emit-perf.md)): the cost was node-gi
   re-resolving per call what is a pure function of (GType, name), not the N-API crossing. On the
   host `set`/`notify` is now 46.4x → **14.4x** (21 237 → 6 540 ns/op) and emit 23.9x → **19.3x**
   (3 153 → 2 505). **Confirmed on the emulator** in step 3 with a locally built `libnode_gi.so`
   (same report, "Confirmed on the emulator"): `set`/`notify` 99.4x → **~25x** (59 729 → ~13 µs) and
   emit → **~17–22x** (9 782 → ~4.3 µs), both 2–5x faster than with the published 0.64.0 AAR.
2. ~~Measure a RELEASE APK: compressed delta per ABI and cold start.~~ **Measured** (same report):
   15.77 MB (arm64-v8a) and 16.93 MB (x86_64) compressed per split, +80 ms / 17.8 % cold start on
   the emulator, **+105.5 ms / 13.0 % on an arm64 release APK** (Galaxy S9). Not measured: an APK
   without the payload packaged, and R8 (NativeScript leaves its hooks off, and R8 cannot change a
   `.so`/typelib delta).
3. ~~Wire the dual emulator run: app and storybook tests once per engine, beside the vectors.~~
   **Done**: `tests/integration/nativescript-gi` gained `app/specs/views.ts` (the NativeScript View
   door over registered classes) and `app/specs/storybook.ts` (the NS storybook surface), both
   running in BOTH legs behind `__GJSIFY_GI_UI__`, plus `scripts/run-dual.mjs` (`npm test`) driving
   `--engine real-gio` and `--engine pure-js` one after the other and reporting both. Green on
   `NsGi_API_36`: 80 cases real-Gio, 46 pure-JS. CI runs NONE of it — there is no emulator job; the
   two showcase APKs are still not run per engine. `GJSIFY_GI_UI=0` in every rung of
   `build-release-splits.mjs` keeps the gate-2 size ladder comparable.
4. ~~Flip the default in a small PR citing steps 1 and 2.~~ **Done**: the owner judged ~16 MB per
   ABI and +80 ms acceptable for GJS-identical semantics. The per-target default is a build-time
   file in the port (`src/engine-target.ts`, `src/engine-target.android.ts`, picked by NativeScript's
   platform file resolution like `clipboard-source`), read by `engineForTarget` in adwaita-core's
   slot: a registered engine wins everywhere, an empty slot is the subset off Android and a loud
   refusal naming both calls on it. `usePureJsGObjectEngine()` is the opt-out, and the harness's
   control leg is now exactly that one line. Tests: `engine-slot.spec.ts` (six cases on the
   target rule), `engine-target.spec.ts` (which file says what), `app/specs/engine.ts` on the
   device (the Android bundle really resolved the Android target; the refusal survives the
   bundler with its message intact).
   Still open after the flip:
   - ~~ADR 0105 § 2's twin route.~~ **Decided 2026-10-18 (owner, by spike): the twin stays.** A
     widget cannot be both a GObject and a `View`; layout accepts only `widget.view`, a consumer
     change, for ~1.4x. See [the spike report](../../docs/reports/2026-10-18-adr-0105-inversion-spike.md).
     Perf work on the twin continues; C′ (ADR 0104) is the answer for real GTK.
   - The remaining ~25x on `set`/`notify` is where to look next. `findProtoDescriptor` is no longer
     part of it: settled 2026-10-16 with NO cache (gjs resolves prototype mutation live, so a memo
     has no invalidation story), by bypassing the prototype Proxies' descriptor traps instead —
     ~8–10 % off `set`/`notify` and ~16–21 % off `emit` on the host. See the addendum in
     [the perf report](../../docs/reports/2026-10-15-node-gi-set-emit-perf.md).
