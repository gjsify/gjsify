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

`breakpoint.ts`, `color-scheme.ts`, `scrolling.ts`, `source.ts`, `swipe.ts` and
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

