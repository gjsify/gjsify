<!-- Authored Open-TODO sections — area: adwaita-web (browser custom elements).
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### The web view switchers cannot bind a stack by id

`Adw.ViewSwitcher` and `Adw.InlineViewSwitcher` take their pages from an `Adw.ViewStack` named
by `stack: stack` in a `.blp`, and the NativeScript builder now resolves that reference
(`builderReferences`, `widgets/builder-slots.ts`) and builds the `Adw.ViewStackPage` records.
`<adw-view-switcher>` and `<adw-inline-view-switcher>` still BUNDLE their pages as children, so
`view-stack-pages.blp` (`@gjsify/adwaita-core/src/conformance/blueprints/`) is built by one
renderer only, and the gallery's `Adw.ViewSwitcher` and `Adw.InlineViewSwitcher` blocks cannot
come from a `.blp`. What is left is the two switchers binding an `<adw-view-stack>` by id, as
`<adw-view-switcher-bar>` already does — a second page source in each element, beside the pages
it bundles. `<adw-view-stack-page>` already takes `child` as a slot, which the gallery's view
switcher bar file needed.


### An ARIA relation has no way to name the other widget

`@gjsify/gtk-host` expresses 39 of GTK's 53 ARIA slots through `accessibility={{ … }}` (ADR 0067).
The other 14 are `kind: 'reference'` — `labelled-by`, `described-by`, `controls`,
`active-descendant`, `flow-to`, `owns` and eight more — and they are DECLARED in the type surface
as `?: never` with a runtime `aria-reference` refusal, not omitted.

Marshalling is not what is missing. `Gtk.AccessibleList.new_from_list([widget])` builds exactly
the value GTK wants, measured on GTK 4.22.5; its sibling `new_from_array` is unusable from GJS
(`gtk_accessible_list_new_from_array: assertion 'accessibles == NULL || n_accessibles == 0'
failed`, returns null) and is worth an upstream look of its own.

ADDRESSING is missing: the host has no `id` prop, and a framework `ref` is resolved AFTER the
props of the element that names it are applied — so a ref read where `setAccessibility` runs is
`null` on the render that authored it, and GTK takes a null reference at exit 0. Closing it needs
a decision, not an implementation: either an addressing model on the element model (an `id` the
host resolves within a render root, which is what a `.blp` gets from GtkBuilder's object table),
or a documented two-phase seam where relations are applied after the whole tree is materialised.
Whichever it is, the VALUE KIND already comes from the generated table, so only one runtime branch
and fourteen `never`s change.


### `<adw-source-view>` has no browser suite

It is an opt-in subpath, so `test.browser.mts` never imports it and nothing in
CI renders it. That is how `source-view/theme.ts` kept a second monospace stack
in a TS literal for its whole life while `_variables.scss` claimed the stack had
ONE home — measured on one page, `.cm-scroller` resolved to 'Adwaita Mono',
'Cascadia Code', 'JetBrains Mono', … and a `.monospace` label beside it to the
token's shorter stack. The editor now reads `var(--monospace-font-family, …)`,
verified by hand in Firefox, but nothing HOLDS it: the `stylesheet-font-families`
conformance rule reads `.css`/`.scss`, so a new literal would be invisible again.
Registering a source-view suite pulls CodeMirror into the browser test bundle,
which is why it is a note rather than part of the fix.


### 83 scalar GIR properties no `adw-*` element observes yet

`<adw-alert-dialog>` shipped observing FOUR attributes while `Adw.AlertDialog` carries
eight own properties, and the website's widget table — which reads `observedAttributes` —
truthfully rendered "takes 4 attributes". The DOC was right and the ELEMENT was short.
Nothing compared the two, which is why the gap survived: `check-vocabulary-alignment.mjs`
settles which element NAMES which widget and stops there.

`scripts/check-adwaita-element-properties.mjs` closes the mechanism half. A synthetic twin
of the shipped 4-of-8 element is a self-test VECTOR, so the pin survives the real element
being fixed — a regression test that reads the fixed source proves nothing once it is
fixed.

Two classes are excluded, measured rather than assumed, because a rule with a high
false-positive rate gets disabled and then protects nothing: **271 signal props**
(`on-clicked`, `on-notify-*`; a custom element dispatches events, and an `on-*` attribute
is the inline-handler shape nobody wants) and **47 widget-valued props** (`child`,
`content`, `extra-child`, `title-widget` — slots, since an attribute cannot carry a
widget).

**ENUMS ARE IN SCOPE, and getting that wrong was the first version's own bug.** The
generator spells an enum property `AdwToolbarStyleNick | Adw.ToolbarStyle`, so a namespace
test reads it as object-typed and drops it. A nick is a STRING. 24 enum properties are in
scope; 17 are already observed as attributes today, which is the proof they belong. The
first draft excluded them and hid 14 real gaps behind a justification that did not apply.

The same draft carried a second silent hole worth recording, because it is the
unrepresentative-fixture class: its interface-head reader required a literal space after
`extends`, and the generator wraps long heritage lists onto the next line. **65 of 190
interfaces had no body**, and an element whose body is missing was skipped as unmapped —
so eight elements (`adw-action-row`, `adw-spin-row`, `adw-entry-row`, `adw-expander-row`,
`adw-carousel`, `adw-button-row`, `adw-password-entry-row`, `adw-window`) passed by being
INVISIBLE, and the summary line read "35 elements hold their properties" while the honest
number was 35 of 43. Both shapes are fixture vectors now.

**What remains: 83 scalar properties across 28 elements**, listed in the check's
`KNOWN_GAPS`. They are listed rather than individually justified, deliberately — inventing
83 rationales would be worse than naming none, because a rule without its real reason gets
"simplified" back into the bug. What the list buys today is the RATCHET: a new gap fails,
and closing one fails too until it leaves the list, so the number can only go down.

The worst three are `adw-wrap-box` (13 — its whole layout surface; it observes NO
attributes at all), `adw-about-dialog` (11 — the credit-list and release-notes surface)
and `adw-header-bar` (6 — `show-title`, `show-back-button`, `centering-policy` and the two
title-button toggles). Those three are 30 of the 83 and are the obvious first pass. Each
needs its own decision: some are genuinely missing attributes, and some are properties a
web element is right to expose another way (`artists`/`developers` are string LISTS, which
an attribute carries badly). The check does not pretend to know which; it makes the
question visible.


### Follow-up — adwaita-web style isolation (ADR 0010)

The style-isolation boundary reset (`scss/_reset.scss`) landed. Remaining: document the `--adw-*` / `--*` token set as the public theming contract on the website (the sanctioned external-override API — the counterpart to the isolation); if a second light-DOM Adwaita renderer ever appears, lift the boundary reset into `@gjsify/adwaita-core` (headless) so both share it; keep `$adw-components` in `_reset.scss` in sync with `src/elements/*` (guarded by `style-isolation.spec.ts`). Shadow DOM stays a documented FUTURE option, not adopted.


### `<adw-about-dialog>` opens on its sheet, not on its close button

`AdwModalSurface.present()` focuses the first focusable control inside the
surface, falling back to the surface itself. For `<adw-about-dialog>` built and
opened in ONE task the fallback is what runs, because the close button is
appended from a `queueMicrotask` — `<adw-header-bar>` builds the section it goes
in from its own `connectedCallback`, so it does not exist yet
(`adw-about-dialog.ts`, `_buildPage`). Measured: `document.activeElement` is
`div.adw-about-dialog-sheet`. A dialog that was already in the markup gets the
button, so the two paths differ.

Nothing is broken by it — focus is inside, Escape works, and Tab from the sheet
reaches the button, which is the browser's own order. It is the one place in the
four dialogs where initial focus is not the control the user wants, and the fix
is in `<adw-header-bar>`: build the sections synchronously so a consumer can
append to them in the same task, which removes the microtask from every consumer
rather than adding a second one here.
`packages/web/adwaita-web/src/keyboard-operable.spec.ts` awaits that microtask
and says why.


### `<adw-toggle>` has no `enabled`, so a toggle group cannot disable one segment

Upstream's `AdwToggle` carries `enabled`, and `add_toggle` spends it immediately:
`gtk_widget_set_sensitive (toggle->button, toggle->enabled)`
(`adw-toggle-group.c:871`). The web `<adw-toggle>` observes `label` and `icon-name`
and nothing else, so every rendered button is sensitive and there is no way to
express "this view mode is unavailable right now" short of removing the toggle.

This surfaced while making the group keyboard-navigable. `elements/roving-focus.ts`
documents that its caller must filter `hidden`/`disabled` items — leaving one in
strands the user on a `focus()` the browser refuses, which is why
`<adw-sidebar>` filters and has a spec for it. `<adw-toggle-group>` passes its
buttons through UNFILTERED, deliberately: no `<adw-toggle>` attribute can produce
a disabled or hidden button, so a filter would be a branch no test could reach.
Adding `enabled` therefore means adding the filter and its spec in the same
change, or the first disabled toggle is a focus trap — and that obligation is not
left to this paragraph. `keyboard-operable.spec.ts` pins
`AdwToggle.observedAttributes` to exactly `['label', 'icon-name']`, so the commit
that adds `enabled` fails until someone reads this entry.

**Four siblings surfaced with it (2026-08-28), and the reason they were invisible is the
point.** `check-adwaita-element-properties.mjs` holds an `adw-*` element against its
WIDGET's GIR properties — and `AdwToggle` had no entry in the widget table to be held
against, because that table meant "concrete `GtkWidget` descendant" and `AdwToggle` is
not one. The moment the placement-carrier rule gave it a tag (ADR 0028 § Amendment), the
check started comparing and named five gaps at once: `enabled`, plus `description`,
`name`, `tooltip` and `use-underline`. None is new; the ability to see them is. All five
are in that script's `KNOWN_GAPS` ratchet, so closing one now fails until it leaves the
list.

That is worth generalising beyond this element: **a gate that compares two surfaces is
blind wherever one of them has no entry**, and widening a table is therefore also a way
of discovering what a check was never asked. The vocabulary-alignment gate found the same
thing in the same PR, from the other side — `<adw-toggle>` had been declared web-only
with the reason "descends from GObject.Object, not GtkWidget", which stopped being true.

`orientation` is the second thing missing, and it is not cosmetic. `AdwToggleGroup`
implements `GtkOrientable` (`adw-toggle-group.c:187`), installs `PROP_ORIENTATION`
(`:202`), reorients its layout manager (`:929`) and every separator (`:873`,
`:935`), and `AdwInlineViewSwitcher` forwards the property (`:107`). Neither web
element has it, so both are hardcoded horizontal — `attachRovingFocus(…,
orientation: 'horizontal')` in each — and the keyboard follows the layout
GEOMETRICALLY upstream (`focus_sort_up_down`, `adw-widget-utils.c:339-342`), not
from a property. A vertical group therefore needs Up/Down to move inside and
Left/Right to propagate: the exact opposite of what both elements do today. The day
`orientation` lands, the axis and the `inert` spec row move with it, and
`keyboard-operable.spec.ts` pins `AdwToggleGroup.observedAttributes` so that commit
cannot land quietly. `<adw-inline-view-switcher>` has no such pin yet.

The same commit closed the roving half of this widget, and the entry it replaces
got the ROLE wrong in a way worth keeping: it recommended "giving the group the
tab-list role", generalised from `AdwInlineViewSwitcher` building this widget with
`GTK_ACCESSIBLE_ROLE_TAB_LIST` (`adw-inline-view-switcher.c:702`). That is the one
place upstream OVERRIDES the default — the C marks it `/* Special case for
AdwInlineViewSwitcher */` (`adw-toggle-group.c:856`) — and `AdwToggleGroup` itself
declares `GTK_ACCESSIBLE_ROLE_RADIO_GROUP` (`:1191`). Reading the widget that
consumes a class instead of the class itself is how a ledger entry ends up
prescribing the exception as the rule.


### `<adw-carousel>` does not work in RTL at all, and the reason is its offset model

Measured in Firefox with `document.documentElement.dir = 'rtl'`, three 440 px pages:

    initial              position 0   scrollLeft 0
    scrollToPage(1)      position 0   scrollLeft 0     <- the PROGRAMMATIC path
    drag right 300 px    position 0   scrollLeft 0
    drag left 300 px     position 0   scrollLeft 0

Nothing moves, including the API call, so this is not about gestures. The element's
whole model is `scrollLeft = position * distance` — `_performScroll`,
`_updatePositionFromScroll`, `_applyScrollFromModel` and `_restorePosition` all
assume it, and the SCSS comment that centre-snapping "leaves `scrollLeft =
position * distance` exactly true" is where the assumption is written down. In an
RTL scroll container the origin is at the RIGHT edge and `scrollLeft` runs from 0
DOWN to `-(scrollWidth - clientWidth)`, so `scrollTo({ left: 440 })` clamps to 0
and `scrollLeft / distance` is 0 forever.

Upstream handles it in one place: `update_orientation` computes
`reversed = horizontal && direction == RTL` and hands it to
`adw_swipe_tracker_set_reversed` (`adw-carousel.c:455-465`), which flips the sign
of every delta the tracker sees. The tracker is only half of it here, though —
`elements/swipe-drag.ts` could take a `reversed` flag in an afternoon, and it
would then compute a correct progress and write it to a `scrollLeft` the container
ignores. So the FIX is direction-awareness in the element's offset model first
(one signed helper, four call sites, plus whatever the two indicators assume), and
the gesture's `reversed` flag after it, in the same change that can test it.

Until then the adapter's axis sign is LTR-only ON PURPOSE rather than by
oversight, and its header says so: a `reversed` branch with no reachable
behaviour behind it is the kind of dead arm this repository keeps deleting.


### `allow-long-swipes: false` does not bound a TOUCHPAD flick on the web

`<adw-carousel>` is a real scroll container with `scroll-snap-type: x mandatory`,
so touch and touchpad swiping are the BROWSER's gestures — momentum, rubber-band
and snapping included — and that is the right answer for those two: GTK is
likewise the platform there, and re-implementing them on top of native scrolling
would replace a real gesture with an imitation. The mouse drag is different, has
no native equivalent, and now runs through `AdwSwipeTracker`'s own decision
(`elements/swipe-drag.ts`).

What the split costs is measurable. `AdwCarousel:allow-long-swipes` defaults FALSE
and means "one flick, one page": upstream enforces it by running the touchpad
scroll through the SAME tracker (`handle_scroll_event`, adw-swipe-tracker.c), whose
`get_bounds` limits the reach to one snap point either side of where the gesture
began. The browser consults nothing of the sort. Measured in Firefox on a
three-page carousel: twenty horizontal wheel notches took `position` from 0 to
**2**, two pages, with the attribute at its default.

Closing it means intercepting native scrolling — `preventDefault` on every wheel
event that is not already handled, then driving `scrollLeft` from the tracker, i.e.
owning the momentum the touchpad driver already provides. That trade needs a
measurement of how the imitation FEELS against the native one before it is worth
making, on a touchpad and on a touchscreen, which is why this is an entry rather
than a fix. The mouse-drag path is the proof the arithmetic is right and shared;
what is missing is a reason to take the platform's gesture away from it.


### adwaita-web does not use the color-scheme singleton at all

`packages/web/adwaita-core/src/color-scheme.ts` documents itself as "the single
source of truth for the current Adwaita color scheme plus a change notifier,
shared by every renderer (ADR 0004)". Measured 2026-08-21: `adwaita-web` calls
none of its seven exports — not `adwaitaColorScheme`, `setAdwaitaColorScheme`,
`toggleAdwaitaColorScheme`, `onAdwaitaColorSchemeChanged`, `themeIconColor`,
`isThemeIconColor`, nor either `DEFAULT_ICON_COLOR*`. It answers the question
itself in `src/accent.ts:55` (`isAdwaitaDark`), reading `.theme-dark` /
`.theme-light` and falling back to `matchMedia('(prefers-color-scheme: dark)')`.
The NativeScript bridge, by contrast, re-exports all of it and subscribes from
`adw-icon` and `adw-image-button`.

So `setAdwaitaColorScheme('dark')` is a no-op in the browser, and the two ports
disagree about where the scheme lives while the core claims to be that place.
Not obviously a bug in adwaita-web: a browser renderer that ignored
`prefers-color-scheme` and the stylesheet's own manual override classes would be
the wrong thing, and the core's own header already concedes that "applying the
scheme to a surface is the renderer's job". What is wrong is the core's claim to
be the SOURCE, which nothing holds it to on the browser side.

The decision to make is which way the singleton points: either the browser
element learns to seed and follow it (`isAdwaitaDark` becomes the platform half
that feeds `setAdwaitaColorScheme`, media-query listener included), or the core
docblock stops calling itself shared and the field narrows to the NativeScript
theming path it actually serves. Deferred out of the gate PR that measured it,
because either direction is a behaviour change and would make a review of the
gate impossible.


### Nothing holds `adwaita-web`'s data grid to the shared data-grid vectors

`DATA_GRID_TRACK_VECTORS`, `DATA_GRID_COLUMN_CLASS_VECTORS`,
`DATA_GRID_VARIANT_VECTORS`, `DATA_GRID_CELL_TEXT_VECTORS` and
`DATA_GRID_INTERACTIVE_VECTORS` are driven by
`packages/nativescript-bridge/adwaita/src/data-grid.spec.ts` alone. The string
`DATA_GRID` occurred exactly once anywhere in `adwaita-web`, in a comment
claiming "Both ports are held to `DATA_GRID_*_VECTORS`" — corrected in the same
change as this entry, since the browser half is held to none of them.

`adw-data-grid.ts` does delegate correctly (it imports `dataGridTracks`,
`dataGridColumnClasses`, `dataGridCellText`, `dataGridRowInteractive` and both
normalisers from the core), so this is missing coverage rather than a known
drift. Closing it is a browser-side spec over the five tables, in the shape
`split-views.spec.ts` already uses.

The correction BLINDED the gate that ledgered this, for one commit. Spelling the
five names out in an `adwaita-web` comment made all five read as browser-driven,
because "driven by X" was a plain text scan over every `.ts` under X — comments
included. The original defect was caught only because it used the glob spelling
`DATA_GRID_*_VECTORS`, which contains no individual name. Fixed by resolving
drivers from usage: names outside a comment, in a `*.spec.ts`.

