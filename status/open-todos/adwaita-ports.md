<!-- Authored Open-TODO sections — area: Adwaita cross-port / gallery.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### The gallery's two authored trees agree on a minority of blocks, and the rest is ledgered

ADR 0027 § 9's criterion is *"the same authored tree, rendered through the GTK host and
through `adwaita-web`, satisfies the same `@gjsify/adwaita-core/conformance` vectors with
no per-surface markup branch"*. The entry above says the NAME half is held and the
BEHAVIOUR half is not. This one is about a third thing that was held by nothing at all:
whether the gallery's own sources describe the SAME UI.

They are two files — `scripts/adwaita-gallery-trees.mjs` for the Solid/Vue/React tabs and
`scripts/adwaita-gallery-ns-templates.mjs` for the NativeScript one — written by hand,
independently. Arms 4-6 hold the first against `gtk-host`; arms 7-9 hold the second
against the port. Both were green while `Adw.ExpanderRow` shipped *"Proxy settings"* with
a host and an authentication toggle on three tabs and *"Advanced"* with a developer-mode
toggle and an endpoint on the fourth, children in the opposite order, for as long as both
files existed. Nothing compared one to the other.

**The census that sized the work.** Some blocks carry a tree on both renderers; the rest
are refused by one or by both with a reason already recorded. The paired ones are compared
node by node with the GIR-name case rule as the only transform, and land in five buckets:

| | |
|---|---|
| identical | authored once in `scripts/adwaita-gallery-shared-trees.mjs` |
| `property` | same shape and tags; one renderer has no such property |
| `vocabulary` | same shape; a tag, slot or property is spelled differently |
| `composition` | genuinely different UIs, each forced by a renderer |
| `content` | nothing forced them apart — two authors, two examples |

**How many are in each bucket is not written here.** Arm 11 of
`check-generated-website-data.mjs` recomputes the partition and prints it on every run,
and it fails on a ledgered block whose two trees have BECOME identical — the self-retiring
shape of arm 5b's stale-refusal rule, so the branches closing the renderer gaps one
property at a time cannot leave a dead reason standing. This entry used to carry the
counts in a table and in its own heading; both were behind the tree by the time anyone
read them, which is the reason the numbers are gone rather than corrected.

**What blocks the ledgered ones, in the order it can be paid.**

*The `property` ones are renderer work and are already in flight or trivially scoped.*
`Adw.Avatar` needs `showInitials` and `iconName` on the NativeScript `AdwAvatar`, whose
whole Adwaita surface today is `size` and `text` — and whose `set text` always renders
initials, so there is no icon path to reach either. `Gtk.Entry` needs nothing:
`widthRequest` is a GTK size request and the port has no layout surface, so this one may
stay ledgered forever. `Adw.PasswordEntryRow` and `Adw.Spinner` are the same shape from the
other side: `adw_password_entry_row_class_init` and `adw_spinner_class_init` install NO
properties at all, so `revealed` and `spinning` have no GIR counterpart to converge on —
libadwaita keeps the reveal toggle as a private `GtkButton` suffix, and an `Adw.Spinner`
cannot be stopped where a `GtkSpinner` can. (Both were first written up as a difference in
what libadwaita EXPOSES — a peek icon, a size — which named a property of `GtkPasswordEntry`
and one nothing has; the classes install none.) `Adw.ButtonRow` is the interesting one:
`startIconName` exists on BOTH and means different things, an icon NAME on GTK and an
Adwaita symbolic SVG STRING on the port. A property that agrees on its name and disagrees on
its value is worse than one that is missing, and `check-vocabulary-alignment.mjs` counts it
as agreement.

*The `vocabulary` ones close for free when the convergence that gate already counts down
lands* — `label`/`text`, `wrap`/`textWrap`, `cssClasses`/`class`, and the three header-bar
slots spelled `start`/`title`/`end` against `startBox`/`titleWidget`/`endBox`. The shared
source admits a block only when it needs no alias, and that rule applies to a PLACEMENT the
same way (ADR 0071): a row's `prefix`/`suffix` are spelled identically by all three
renderers and the corpus authors one, a header bar's three still need three names and its
block stays here. A renderer handed a name it does not have refuses by name rather than
placing the child somewhere close by, so the remaining gaps are loud. `Adw.Spinner` sat here until its `spinning`
half was read: a `vocabulary` entry PROMISES the block lands in the shared source for free
when the renames land, so a missing property filed under it is a promise nothing can keep.

*The `composition` ones each need a decision before they need code*, and two of them are
the same decision twice: an `AdwHeaderBar` title is a slotted `AdwWindowTitle` child on GTK
and a plain `title` property on the port, so `Adw.OverlaySplitView` and `Adw.ToolbarView`
carry two nodes more on one side than the other. Converging them means deciding which
renderer is wrong, which is an ADR 0034 question and not a gallery one.

*The `content` ones are the ones nobody has an excuse for*, and `Adw.WrapBox` and
`Gtk.Button` are left as measured rather than fixed because closing the LIST would not move
either into the shared source: each also carries a `cssClasses` against the port's
style-class property, and that half does not close by renaming. `@nativescript/core`'s
`ViewBase` already owns the name — its constructor assigns `this.cssClasses = new Set()`,
its `ClassSelector.match` reads
`node.cssClasses.has(…)` and its `className` setter clears and refills the same Set — so
taking the name means shadowing that field with an accessor pair that still hands the CSS
engine a live mutable Set, and the value kinds differ besides (`string[]` against
`Set<string>`). Padding the lists moves them from `content` to `vocabulary`, which is a
bucket sideways and not a block shared. `Adw.WrapBox`: the block
preview and three tabs show eight chips, the NativeScript template six. `Gtk.Button`: five
buttons against four, the icon-only circular one missing. `Adw.SpinRow` joined them later
and is the one with a second half: the examples differ ("Font size" against "Copies"), and
so does the value KIND, which does not close by matching the numbers — an adjustment is an
OBJECT a JSX expression carries on one side and the JSON STRING its XML door parses on the
other (ADR 0047 § 5). The rule that settles the LIST half is the one `Adw.WrapBox`'s own
tree already states — a gallery block is one widget written several ways, so its `preview`
fragment is the authority — and in every case here it is the NativeScript template that
drifted from it.

The census also found the `Adw.WrapBox` chip list spelled `Typescript` in seven authored
sites and `TypeScript` in one — the NativeScript template, the only one that was right. All
seven were corrected here. It is worth keeping because of WHERE it hid: seven of the eight
copies agreed, so every majority-wins reading of the gallery would have propagated the
typo, and no arm compares a chip label to anything at all.

**What this does NOT close, now that the suite exists.**
[ADR 0051](../docs/adr/0051-one-authored-tree-rendered.md) is Accepted and the corpus is
BUILT by two renderers — `packages/framework/gtk-host/src/shared-trees.spec.ts` on GJS and
`packages/web/adwaita-web/src/shared-trees.spec.ts` in the browser, joined to the vectors by
`adwaita-core/src/conformance/shared-trees.ts`. What is still open is the CORPUS, not the
driver, and the ledger above is the backlog: the suite proves what it proves about the
blocks in the shared source and the vector rows their authored values instantiate. That
denominator is not written here on purpose — `check-adwaita-conformance-drivers.mjs` prints
the joined tables and arm 11 the partition, every run, and a figure copied into this file
would be right until the next row lands.

Three limits are structural rather than backlog, and each is measured in the binding's own
header: a `GParamSpec`-default table cannot be read off a CONSTRUCTED widget (`AdwBanner`'s
`use-markup` pspec default is TRUE and a fresh `AdwBanner` answers FALSE on libadwaita
1.9.3); a table whose expectation is a LOCALIZED rendering asserts a fact about the runner
(`<Control>C` draws `["Strg","C"]` on a de_DE host, and the locale cannot be moved from
inside the process); and the `emitted` half of a notify table needs a listener an authored
tree has nowhere to put.

**The NativeScript port is not the second driver, and cannot be one off-device.** ADR 0051
proposed it and the measurement overturned that: every widget module under
`packages/nativescript-bridge/adwaita/src/widgets/` evaluates a bare `@nativescript/core`
specifier at module scope, and the port's own specs say in their headers that they must not
import those modules — they drive the pure siblings instead. Installing the optional peer
would not help: `@nativescript/core` ships a widget class only as `index.android.js` /
`index.ios.js`, never a platform-neutral `index.js`, so the base class those widgets extend
does not resolve outside a device — the measurement is in the ADR's Amendment 1. A
device-bound driver would not be a CI guard, which is why the second driver is
`adwaita-web`: the renderer ADR 0027 § 9 named in the first place.

**The `preview` fence is NOT emitted from the corpus, and the direction is settled the
other way.** ADR 0051's last open stage asked for exactly that, and the measurement
overturned it — ADR 0051 § Amendment 2 carries it block by block, and the count is left
there with its commit rather than copied here. Some shared blocks already read as the
corpus would emit them; the rest each document something a `SharedNode` cannot author, and
not one of those is an accident: a `slot=` child on a header bar and a
`Gio.ListModel` row (the corpus carries only placements every renderer spells the same, and
ADRs 0042/0046/0047's portable values have no shared spelling), four further examples of one widget beside a flex wrapper
(a tree driver builds ONE tree), and a generated gloss line that
`generate-adwaita-attribute-comments.mjs` owns and arm 12 holds. The corpus is SELECTED for
agreement between two renderers, so what it drops is exactly what they disagree about —
which is what a reader most needs the page to show. What landed instead is arm 13 of
`check-generated-website-data.mjs`: every node of a shared tree occurs in that block's
`preview` fence, same element, attributes and values, in the same order, the fence free to
carry more. That closes what arm 11 cannot see — two authored trees can agree with each
other and both describe a UI the block stopped showing.

Still open beside it, and deliberately not claimed by arm 13: the framework tree of a
LEDGERED block is held against its own fence by nothing. That is the wider arm, and it
needs its own measurement first — the ledger's `content` entries say the templates drifted
from the fence, which is the same drift one artifact over and was found by hand.


### A constructed `Adw.Banner` does not interpret markup, and both ports say it does

Found by the tree driver ADR 0051 landed, which is the first thing in this tree to read a
`GParamSpec`-default table off a widget a renderer actually BUILT.

`BANNER_DEFAULT_VECTORS` states `AdwBanner:use-markup` defaults to TRUE, and the pspec agrees
— `Adw.Banner.find_property('use-markup').get_default_value()` is `true` on libadwaita 1.9.3.
A freshly constructed `Adw.Banner` answers FALSE, from `get_use_markup()` and from
`get_property('use-markup')` alike.

**The mechanism, measured rather than read off the C** (`refs/libadwaita` is not a checkout
here): the banner's getter DELEGATES to its template `GtkLabel`. `adw-banner.ui` — read out
of the installed GResource at `/org/gnome/Adwaita/ui/adw-banner.ui` — sets `use-underline`,
`ellipsize`, `wrap` and more on that label and never `use-markup`, so the label keeps
`GtkLabel`'s own FALSE; and a pspec default is not written through a setter, so the banner's
TRUE never reaches the label. Assigning `label.useMarkup = false` directly makes
`banner.useMarkup` report `false`, and `banner.set_use_markup(true)` makes both report
`true` — which is what identifies the read as a delegation rather than a stored field.

**What it costs.** Both Adwaita ports implement the pspec default, so the same authored
banner interprets `<b>bold</b>` in the browser and paints it literally in GTK. That is a
user-visible rendering difference on the exact surface ADR 0027 § 9 is about.

**Why it is not fixed here.** Deciding it changes what two published renderers paint, and it
changes a conformance row whose `rule` cites `adw-banner.c` line numbers that cannot be
checked without the submodule. The candidates are not equivalent: teach
`BANNER_DEFAULT_VECTORS` to carry the CONSTRUCTED default beside the pspec one (the honest
shape, since `gtk-host`'s contract already sides with construction and the two disagree in a
hundred-odd places), or keep one column and decide which fact a renderer is held to. Either
way it wants its own change with its own vectors. The tree drivers do not paper over it:
they take no pspec-default table at all, and the reason is in
`adwaita-core/src/conformance/shared-trees.ts`'s header.


### The gallery's two authored PANES are now measured too, and five of forty are one text

The sibling fact to the entry above, one surface over. That one is about the gallery's two
authored TREES — the data two generators emit. This one is about the two authored PANES a
reader actually copies: the `gjs` fence and the `nativescript` fence of the same block.

ADR 0034 § Amendment 12 said the `gi://` arms were *"the last of the two things keeping the
website's Native TypeScript and NativeScript snippets from being the same text"*, and left
the snippets alone. Stages 8 and 9 both landed on 2026-09-05 and neither was cashed in on the
documentation surface for four days, because nothing MEASURED the distance: no arm read a
`nativescript` fence against its `gjs` sibling, so "the two are now closer" was unfalsifiable.

Arm 12 of `check-website-adwaita-gallery.mjs` is that measurement — this file and not
`check-generated-website-data.mjs`, whose arm 11 holds the same claim over the two trees but
never opens an `.mdx`. ONE declared normalisation: the lines that BIND the widget namespaces
are read as the namespaces they bind, so `import { Adw, Gtk } from '@gjsify/adwaita-nativescript'`
and the two `gi://` lines compare equal. That normalisation is what makes the number honest —
without it this very change could have halved the printed distance by editing forty import
lines and moving no program. It is held on its own output by vectors, because the partition
vectors cannot see a widening that changes no verdict: measured, widening the specifier set to
`@gjsify/*` left every partition vector green and moved only the distance.

The numbers are PRINTED, never written here. What the change was measured against: 40 pairs,
0 identical, distance 599 lines before; 5 identical after, and the remaining 35 ledgered by
the KIND of work that would close each one — a rename, a glyph, renderer work, or a different
program. Ledger entries are self-retiring, the shape arm 5b and arm 11 already have.

**The `nativescript` fence is a CORPUS now, not a tab** (ADR 0034 § Amendment 16). It is still
authored on all 40 blocks and still arm 12's only input; it is no longer rendered anywhere,
because the end state of this convergence is that the two panes are the same program under two
labels. Do not look for it on a page, and do not delete it: the fence IS the measurement. The
category is declared in `AdwWidget.astro`'s `CORPUS_SLOTS` and arm 6 refuses an entry no arm
reads.

**What is left, with its price.**

- *The `glyph` entries are CLOSED, and closing them was one renderer decision.* Every icon
  property on the port took an SVG SOURCE, so those panes imported a glyph from
  `@gjsify/adwaita-icons` where the GJS pane writes `'folder-symbolic'`. ADR 0034
  § Amendment 18 gave the port `icon-theme.ts` — a compiled subset plus a `registerIcon()`
  door, the shape `@gjsify/adwaita-web`'s `icon-registry.ts` already had — and the whole
  kind went at once: `glyph` is 0, eighteen panes lost an import line, and the printed
  distance fell from 481 to 445. The SVG-source door stayed open.
- *The `composition` entries split two ways.* Four are the `layout.mdx` blocks, where the
  NativeScript window is an XML template plus a loader and the TypeScript pane is therefore a
  `~/adw` barrel and a `Builder.load()` — not a widget construction at all, and not a
  divergence a rename could close. The rest are blocks where the port has no counterpart
  widget (`Gtk.Box`, `Gtk.Label`, `Adw.CarouselIndicatorDots`) and a `@nativescript/core`
  layout stands in.
- *The `property` entries are the renderer backlog*, and they overlap the `property` bucket of
  the tree census above rather than repeating it: a pane can differ on a property the two
  trees never carried.
- *`Gtk` is the narrow half.* The arm answers `Adw` and `Gtk` and the NativeScript renderer
  has 5 of 106 `Gtk` members, so every GTK widget a gjs pane reaches for outside
  Button/DropDown/Entry/Image/MenuButton is a `property` entry by construction.

**What this does NOT close, and it is the same limit as the entry above.** Two panes being one
text is not two runtimes behaving the same. The panes are compared as TEXT; nothing here runs
either of them. `check-doc-fences.mjs` holds every property a NativeScript pane writes —
through an assignment or through the construct-props bag — against the port's own declared
members, which is what makes a converged pane checkable rather than merely plausible, but that
is a name check too. See *The doc fences that show no imports are unread, on purpose* for the
API-shape gap that a tsc pass would close and this one does not.


### An adopted composite offsets by its own internals

Surfaced while reviewing the Solid/Vue adapters, pre-existing in the host rather than
introduced by them, and recorded with the measurement rather than shipped quietly. Its
sibling — a removed element child not restoring the text it displaced — is FIXED; this
one is not, because its fix needs a curated descriptor field and a measurement round of
its own.

A fresh `Adw.PreferencesPage` has one direct child, its internal `GtkScrolledWindow`, so
`adopt()` records `foreign.length === 1` and every subsequent `index` is off by one.
Measured on gtk 4.22.4 / libadwaita 1.9.3: `mountRoot` into an `AdwPreferencesPage`,
insert a group "one", then prepend "zero" before it, and GTK renders **[one, zero]**;
the identical tree in a NON-adopted page renders **[zero, one]**. Exit 0, zero
diagnostics. Reachable from any `<For>`/`v-for` that prepends into the canonical Adwaita
settings page. Adder slots that are NOT composites are fine — an adopted
`AdwToolbarView` still renders `[app bar, host bar]`.

**Located.** `adoptedChildren()` (`src/host.ts`) branches on
`setterSlots(descriptor.children)`: with setter slots it asks each slot's GETTER, which
is why the one-child case is right, and with none it falls through to
`directChildren(container)`, a raw child-list snapshot. `AdwPreferencesPage` has no
setter slot, so its internal `GtkScrolledWindow` is counted as application content. The
second half of the bug is what the index MEANS: `Adw.PreferencesPage` is one of the few
Adwaita containers that really has `insert`, and its `position` addresses the page's
GROUPS, not its direct children — so a `foreign` of length 1 offsets every position by
one.

The shape of the fix follows, and it is a CURATED discriminator rather than a derived
one. For a container whose adder re-parents into an internal, the direct children are
never adder-addressed content — and nothing introspectable says which containers those
are, because the internal child comes from a `.ui` template. So it is a new descriptor
field in the ADR 0028 § 2 sense (what the GIR cannot express stays curated), plus the
measurement of which of the 26 curated containers need it. Deriving it by adding a probe
child and reading `get_parent()` back would mutate the very container being adopted,
which belongs to the application.


### Follow-up — adopt `@gjsify/adwaita-app` in the shell consumers (ADR 0009)

Adoption is opportunistic, not a rewrite — wire each consumer onto the shell package on its next shell touch. **Three of the four are done** (measured 2026-09-14: buchhaltung `app/src/frontends/desktop`, eco-retrofit `cli/src/app` and troedler `app/src/frontends/gui` all import the package), which also retired eco-retrofit's latent `Adw.Application.run(null)` → `runAsync()` hang. What is LEFT is `@gjsify/storybook`: re-base `StorybookApplication` onto `AdwaitaApp`/`runAdwaitaApp`.


### `AdwToastOverlay`'s `timeout` option means seconds on one port and milliseconds on the other

Measured 2026-08-21, while checking a reported "the toast default is 5000 in the
core and 5 in the browser element" — which is NOT a defect. `refs/libadwaita`
settles the units: `adw-toast.c:385` documents `AdwToast:timeout` as "the timeout
of the toast, **in seconds**" and `adw-toast.c:475` sets `self->timeout = 5`.
adwaita-core counts MILLISECONDS and says so on every field, so
`DEFAULT_TOAST_TIMEOUT = 5000` is 5 s and is right; `adw-toast-overlay.ts` takes
SECONDS as its public unit, `DEFAULT_TIMEOUT_SECONDS = 5` mirrors
`Adw.Toast:timeout` exactly, and it converts once at the boundary (`* 1000`,
line 142) — also right. Nothing vanishes in 5 ms or lingers for 5000 s.

The real divergence is one level out, between the two RENDERERS. Both export a
class called `AdwToastOverlay` taking an options bag whose field is called
`timeout`, and the two mean different things:

- `adwaita-web` — `addToast(title, { timeout })` is SECONDS (its own
  `AdwToastOptions` interface). Its spec writes `{ timeout: 3 }` for three seconds.
- `@gjsify/adwaita-nativescript` — `showToast(title, { timeout })` passes the
  bag straight to `new AdwToast(...)`, so it is the CORE's `AdwToastOptions`,
  i.e. MILLISECONDS. This wrapper has NO spec of its own: `widgets/adw-toast-overlay.ts`
  is untested, and the `{ timeout: 3000 }` at `index.spec.ts:731` constructs
  `AdwToast`/`AdwToastQueue` directly, never reaching the overlay. That makes the case
  stronger, not weaker — the diverging wrapper is the untested one.

`{ timeout: 5 }` is therefore a five-second toast in the browser and a five-
MILLISECOND toast on NativeScript. Each suite is internally consistent, which is
why neither catches it, and no conformance vector table covers `toast.ts` at all
(see the module-gap entry above), so nothing holds the two ports to one answer.

Fixing it is a public-API change on one of the two ports and wants a decision
first: libadwaita's own spelling is seconds, which argues for the browser being
right and the NativeScript wrapper growing the same `* 1000` boundary — at the
cost of breaking anyone passing milliseconds today. Deferred out of the gate PR
that measured it; a behaviour change would have made that PR unreviewable.


### Adwaita renderer asymmetries with no verdict yet

`scripts/check-storybook-widget-coverage.mjs` demands a verdict for every widget only
one renderer ships (#1195): a `decision` with its reason, or a `gap` pointing here.
Most are decisions with a reason next to them. These are the ones nobody has settled
from outside the port — each is a product question, not scheduled work, which is
exactly why they must not be written as decisions.

- **`<adw-radio>` and now `<gtk-switch>` on NativeScript.** `Gtk.CheckButton` ships there
  now (it carries the radio-group behaviour, so a shared template's `group` binding
  builds), and `<adw-radio>` stays web-only: the headless half exists —
  `@gjsify/adwaita-core` carries `RadioGroupState` and `RADIO_GROUP_VECTORS` — but the
  browser element is a separate tag over the same class, and whether a touch target wants
  a second spelling of it is the open decision. The switch is the mirror image: its widget
  DOES exist (`@nativescript/core`'s `Switch`, installed by `AdwSwitchRow`), so what is
  missing is the second boolean — `GtkSwitch:state`, the half that makes a slow backend
  look pending (`refs/gtk/gtk/gtkswitch.c:39-43, :637-654`) has nowhere to go in a
  one-boolean `Switch`.
- **`<gtk-progress-bar>` on NativeScript.** libadwaita styles the GtkProgressBar node in
  `stylesheet/widgets/_progress-bar.scss` and the browser ships the element; the
  NativeScript port has no progress widget. The PLATFORM half is not what is missing:
  `@nativescript/core` ships a determinate `Progress` (`value`/`maxValue`, `ui/progress`),
  exported from the same package root this port already takes `Switch`, `Slider` and
  `ActivityIndicator` from — unlike the checkbox above, this is not a platform survey.
  What is open is the Adwaita EXPRESSION: `progressbar > trough > progress` has no
  equivalent in the NativeScript CSS subset this theme is confined to, and `.osd`, the
  text label and the fraction have no counterpart at all. So the question is what a
  determinate Adwaita progress bar should even look like there, not whether one is
  buildable. Its story is therefore ledgered as not rendered there
  (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`) and its XML
  template refused.
- **`<gtk-stack-switcher>`, `<gtk-stack-sidebar>` and `<gtk-notebook>` on NativeScript.**
  `Gtk.Stack` and `Gtk.StackPage` ship there now (a layout that shows one child at a time,
  built for Learn6502's shared templates), so the stack itself is no longer open. The three
  that remain are the same question from different sides, and it is about the Adwaita
  EXPRESSION rather than the platform: `@nativescript/core` ships `TabView`, but it owns its
  own tab strip, which is `GtkStackSwitcher` AND `GtkStackSidebar` in one and has no
  content-only half to drive one of them with. The transitions stay unmodelled: the 23
  members of `GtkStackTransitionType` (`refs/gtk/gtk/gtkstack.c:95-121`), the two-way nick
  resolved by page order (`get_simple_transition_type`, `:1162-1200`) and the reduced-motion
  swap to a crossfade (`:1320-1340`) are GTK's own animation vocabulary, and a NativeScript
  page transition is chosen by the platform, not authored. So the three stories are ledgered
  as not rendered there (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`)
  and their XML templates refused.
- **`<gtk-drawing-area>`, `<gtk-gl-area>`, `<gtk-graphics-offload>` and `<gtk-drag-icon>` on
  NativeScript.** Four browser elements with their blocks and stories. `Gtk.DrawingArea` ships
  as a constructible STUB (so Learn6502's shared templates build): `set_draw_func` throws and
  `queue_draw` is a no-op, because nothing in the port paints — a drawing area is an empty view
  with a size request, and its story stays unrendered there. The other three have no
  counterpart at all. The GL area
  is the harder half of the same question: a GPU surface is what `@nativescript/core` has
  NO view for, and the whole contract is a signal pair
  (`::resize` before the first `::render`, `needs_render` cleared after the emit,
  `refs/gtk/gtk/gtkglarea.c:797-811`) a `View` cannot express. So the open questions are
  whether a phone target wants a widget whose entire content is a callback the framework
  cannot serialise, and whether the answer is a `<canvas>` reached through the web view this
  port already loads elsewhere. The offload wrapper is the third question of the three and
  the easiest to state: a video or a `WebView` sits in a `GridLayout` cell and the platform
  composites it like every other view, so `Gtk.GraphicsOffload` would be a container with
  nothing to pass on — and GTK's own list of what PROHIBITS offload
  (`refs/gtk/gtk/gtkgraphicsoffload.c:64-75`: a clip, an alpha channel, a filter, a
  transform beyond translation and scale) is a list the port cannot even check for. The drag
  icon is the fourth question and the shortest: it is not a widget an application builds at
  all — `gtk_drag_icon_get_for_drag` returns the icon a drag is USING and GTK destroys it
  with the drag (`refs/gtk/gtk/gtkdragicon.c:42-58,400-421`) — so it needs a drag gesture to
  belong to, and `@nativescript/core` has none to attach a controller to. The port can show
  what a dragged row would carry (`GtkLabel`, and `GtkLabel.set_markup` for the markup case)
  and can put it in a `GtkBox`, which is the whole of the widget minus the one part that
  makes it a widget. All four stories are therefore ledgered as not rendered there
  (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`) and their XML
  templates refused.
- **`<gtk-level-bar>` and `<gtk-spinner>` on NativeScript.** Both browser elements and
  their gallery blocks exist; the NativeScript port has neither, and both refusals are
  about a widget the port already has a NEAR NEIGHBOUR for. `ActivityIndicator` is the
  indeterminate spinner and takes no value, so the level bar has no determinate view to
  borrow and `pulse-step`-style control has no counterpart either; `AdwSpinner` is the
  libadwaita replacement for `GtkSpinner` and the port ships that one, so the GTK picture
  — the faint ring with a quarter arc — has nothing standing behind it. What neither
  answer settles is the Adwaita EXPRESSION: a segmented, offset-coloured bar
  (`levelbar > trough > block.filled.low`, `refs/libadwaita/src/stylesheet/widgets/
  _level-bar.scss:71-93`) and the reduced-motion hourglass swap
  (`refs/gtk/gtk/gtkspinner.c:145-161`) are both libadwaita-over-GTK decisions a
  platform spinner makes for itself.
- **`<gtk-inscription>`, `<gtk-picture>` and `<gtk-media-controls>` on NativeScript.**
  Three browser elements and their gallery blocks exist; the NativeScript port has none of
  the three, and each refusal is a NEAR NEIGHBOUR rather than a platform survey.
  `GtkInscription` sizes itself in CHARACTERS and LINES and never looks at its own text
  (`refs/gtk/gtk/gtkinscription.c:338-349`); the port's text primitives are a NativeScript
  `Label` and an `AdwEntryRow`, both of which ask their content for a size — that is
  `GtkLabel`'s half of the pair and not this one, so the widget has no counterpart to borrow
  the two character counters from. `GtkPicture` fits a `GdkPaintable` by `content-fit`, and
  the port's `Image` carries its own `stretch` modes: fitting an image is the port's
  existing job, and there is no second widget to hold the fit. `GtkMediaControls` holds
  exactly ONE property and it is an object, `media-stream`
  (`refs/gtk/gtk/gtkmediacontrols.c:296-306`), so the widget is a pure view of a stream the
  backend owns; the port's `Video` is the play surface itself with no bar drawn over it, and
  there is no `GtkMediaStream` to drive one from. What none of this settles is whether the
  Adwaita EXPRESSION for any of them is wanted on a touch target: an icon, a fitted picture
  and a transport bar are the three things a phone already does natively, and the browser
  replicas exist because a document is a different medium, not because the widgets are
  missing. Their stories are ledgered as not rendered there (`NOT_ON_THIS_TARGET` in
  `scripts/check-storybook-story-parity.mjs`) and their XML templates refused.
- **`<gtk-video>` on NativeScript.** `@nativescript/core` DOES ship a `Video`, and that is
  exactly what makes this one different from the three above: the frames are the only part of
  `GtkVideo` that platform code covers. The widget is a play SURFACE — the three overlay nodes
  over the media are the whole of it (`refs/gtk/gtk/ui/gtkvideo.ui`), and the transport lives
  in a separate `GtkMediaControls` the port also has no host for. So the open question is
  whether the overlay icon and the self-hiding controls bar are a wanted phone idiom at all
  (`refs/gtk/gtk/gtkvideo.c:125-133` is the three-second reveal), which is a product question
  rather than a buildability one: a `<Video>` with a native overlay is what a platform already
  offers. Story ledgered as not rendered there, XML template refused.
- **`<adw-shortcuts-dialog>` on NativeScript.** `AdwDialog` ships there now, as an in-app
  overlay card over a scrim (`widgets/adw-dialog.ts`), so the generic-dialog half is closed.
  What remains is a platform fact rather than an unwritten port: a touch target has no
  keyboard, so there is no accelerator to list, and the port has neither the dialog nor the
  `AdwShortcutsSection` / `AdwShortcutsItem` GObjects to build it from. Its whole shortcut
  surface is `<adw-shortcut-label>`, one keycap.
- **`<gtk-about-dialog>`, `<gtk-emoji-chooser>`, `<gtk-page-setup-unix-dialog>` and
  `<gtk-print-unix-dialog>` on NativeScript.** Four browser elements and their gallery blocks
  exist; the NativeScript port has none of the four, so their stories are ledgered as not
  rendered there (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`) and
  their XML templates refused. The port's ONE about dialog is `AdwAboutDialog`, a
  `GridLayout` of preference rows — GTK's is a window with a stack switcher over Credits,
  License and System pages, and the two are one widget only by name, which is half of what
  this bullet is about. The other three have no counterpart of any kind: an emoji chooser
  needs a popover AND the emoji table behind `org.gtk.gtk4.Settings.EmojiChooser`, and a
  page-setup or print dialog needs paper sizes, margins and a printer list, which come from
  CUPS over D-Bus (`gtk_print_backend_load_modules`) — a print subsystem no phone has. So the
  open question is not whether each CAN be built: it is whether a document that has to be
  printed, or an emoji inserted from a keyboard, is a phone interaction at all, and what its
  Adwaita expression would be if it were.
- **`<gtk-paned>` and `<gtk-expander>` on NativeScript.** `Gtk.Separator`,
  `Gtk.ToggleButton`, `Gtk.Overlay` and `Gtk.Revealer` ship there now; these two browser
  elements and their gallery blocks do not, so their stories are ledgered as not rendered there
  (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`) and their XML templates
  refused. Both are CONTAINERS: a paned is a question about splitting that no NativeScript
  layout answers in the Adwaita idiom, and the expander's disclosure is the one shape the port
  is missing where libadwaita's own is `AdwExpanderRow`, which it already has. So the open
  question is the EXPRESSION of each, not whether a view can be built.
state. The other four are CONTAINERS: `GtkBox` places each child into a slot it already
  names, so an overlay, a paned and a revealer are each a question about stacking, splitting
  and animation that no NativeScript layout answers in the Adwaita idiom — and the
  expander's disclosure is the one shape the port is missing where libadwaita's own is
  `AdwExpanderRow`, which it already has. So the open question is the EXPRESSION of each,
  not whether a view can be built.
- **`<gtk-scale>`, `<gtk-spin-button>`, `<gtk-password-entry>` and
  `<gtk-search-entry>` on NativeScript.** Four browser elements and four gallery blocks;
  the NativeScript port has none of the widgets, so all four stories are ledgered as not
  rendered there and their XML templates refused. The HEADLESS half is already shared:
  `SpinState` in `@gjsify/adwaita-core` is the `Gtk.Adjustment` all of them take, so what
  is missing is the VIEW each is built from, and each one names a neighbour that is not
  the same thing — `AdwSliderRow` is a boxed-list row around the `@nativescript/core`
  `Slider`, `AdwSpinRow` composes `Label` and `StackLayout` itself, `AdwPasswordEntryRow`
  is the row `GtkEntry` is not, and `GtkEntry` carries no icon, no clear button and no
  delayed signal for a search field to hang. Whether a standalone scale or a standalone
  search field belongs on a touch target at all is the product question, not a port.
  state.
- **`<gtk-action-bar>`, `<gtk-header-bar>` and `<gtk-window-controls>` on NativeScript.** All three
  browser elements and their gallery blocks exist; the NativeScript port has none of the three, so
  their stories are ledgered as not rendered there (`NOT_ON_THIS_TARGET` in
  `scripts/check-storybook-story-parity.mjs`) and their XML templates refused. This is not a
  platform survey the way `<gtk-check-button>` above was: the port ALREADY ships
  `AdwHeaderBar` and `GtkActionBar` (`widgets/adw-header-bar.ts`, `widgets/gtk-action-bar.ts`), so
  what is missing is the GTK HALF of each — a titlebar whose centre is a plain derived `GtkLabel`
  rather than an `AdwWindowTitle` (`gtkheaderbar.c:274-290`), and a bottom bar that is a GTK widget
  rather than the one libadwaita styles. The third is the one with no neighbour at all:
  `GtkWindowControls` draws its buttons from `Gtk.Settings:gtk-decoration-layout`
  (`gtkwindowcontrols.c:129-140`), a display-wide default NativeScript has no equivalent of, so the
  question is what a touch target's window chrome should be at all — and whether the platform's own
  title bar is the whole answer.
- **`<gtk-window>`, `<adw-window>` and the application windows on NativeScript.** All of
  them exist there now as the full-size ROOT CLASS a `template $Foo : Adw.Window` builds
  into; the platform's `Page` stays the screen (`Page.adw-window`,
  `packages/nativescript-bridge/adwaita/src/theme/adwaita.css:23-24`). What is undecided is
  the frame PROPERTY half: `decorated`, `deletable`, `resizable`, `maximized` and
  `hide-on-close` decide which frame buttons a page draws (`gtkwindowcontrols.c:270-274`), and a
  `Page` has nothing for them to decide. `GtkApplicationWindow` adds a menubar built from the
  application's `GMenuModel` (`gtkapplicationwindow.c:337-348`), and whether a phone has room for
  one is the product question.
- **The four model-driven views on NativeScript.** `<gtk-list-view>`,
  `<gtk-grid-view>`, `<gtk-column-view>` and `<gtk-tree-expander>` exist on the browser
  with their gallery blocks; the NativeScript port has none of the four, so their stories
  are ledgered as not rendered there (`NOT_ON_THIS_TARGET` in
  `scripts/check-storybook-story-parity.mjs`) and their XML templates refused. What is
  open is not the model — `ListViewState` and the vector tables beside it are portable and
  renderer-neutral (ADR 0089) — but the FACTORY: a `@nativescript/core` `ListView` takes an
  `itemTemplate`, which is markup rather than the function the portable factory is, and
  deciding whether a template string or a per-item view builder is the NativeScript
  spelling is the question nobody has answered. The column view needs that answer twice
  over, once per column.
- **`<gtk-link-button>`, `<gtk-scale-button>`, `<gtk-color-dialog-button>` and
  `<gtk-font-dialog-button>` on NativeScript.** All four browser elements and their gallery
  blocks exist; the NativeScript port has none of the four, so the four stories are
  ledgered as not rendered there and their XML templates refused. Each is a different
  reason rather than four versions of one. A link button is `GtkButton` plus a URI and a
  visited state, and `Button` has no `visited` either — but NativeScript could launch the
  URI through `Utils.openUrl`, which no browser port needs to do by hand. A scale button
  is `GtkButton` plus a popover holding a `Slider`: the parts are all in `@nativescript/core`
  (`Button`, `Slider`), and what is missing is the composition and the icon that follows
  the value. A colour dialog button and a font dialog button both need a CHOOSER the
  platform does not export: the browser substitutes `<input type="color">` and a family
  list, and there is no `@nativescript/core` view for either, so the open question there is
  whether a colour or font picker belongs on a touch target at all.
- **`<adw-breakpoint-bin>`, `<adw-multi-layout-view>` and `<adw-layout-slot>` on
  NativeScript.** All three browser elements, their stories and their gallery blocks
  exist, and the headless half is done — `BreakpointBinState` plus the two conformance
  tables the browser spec drives. The NativeScript port has none of the three widgets,
  so the stories are ledgered as not rendered there and their XML templates refused.
  What is missing is not the picking but the SIZE SOURCE and the tree surgery: the
  breakpoint bin needs a view's post-layout size bound to its own allocation, and the
  multi-layout view has to re-parent children between slots on a platform whose
  `LayoutBase` has no notion of a slot ID. `AdwLayout` is a GObject there too, so the
  layouts need the same markup-to-object step the browser gets for free.
- **`<adw-clamp-scrollable>`, `<adw-preferences-row>`, `<adw-tab-bar>`,
  `<adw-tab-button>`, `<adw-tab-overview>` and `<adw-view-switcher-sidebar>` on
  NativeScript.** The six browser elements and their gallery blocks exist; the
  NativeScript port has none of them (`Adw.Bin` ships now), so their stories are ledgered as
  not rendered there (`NOT_ON_THIS_TARGET`) and their XML templates refused. The scrolling
  clamp needs a scrollable child `@nativescript/core` would have to supply; the preferences row
  is the title half of `AdwActionRow`; the tab bar is the strip of chips over an `AdwTabView`
  the port MERGES into its own tab view, so a separate bar would be the same decision taken
  twice and the `view` binding has no XML spelling there; the tab button is a counter over
  `AdwTabView`'s page list; the tab overview is a second surface stacked over the view that
  holds it, and the switcher sidebar is an `AdwSidebar` driven from an `AdwViewStack`'s page
  list — which `AdwSidebar` has, but no way to bind one to the other.
- **`<gtk-editable-label>`, `<gtk-text>` and `<gtk-search-bar>` on
  NativeScript.** Three browser elements and their gallery blocks exist (`Gtk.TextView` ships
  there now); the NativeScript port has none of the three, so their stories are ledgered as not rendered there and
  their XML templates refused. What each one would be is a question, not an omission:
  `GtkEntry` is the port's single-line field and `GtkLabel` its read-only twin, so
  `<gtk-text>` — the delegate an entry is built from — has no separate counterpart; the
  editable label is a swap between those two plus the commit/discard keys, which no
  `@nativescript/core` view offers; `<gtk-search-bar>` is a revealer plus a key-capture widget, and
  the port's theme has no Adwaita expression for either. The open decision is what the
  Adwaita EXPRESSION of each is on a touch target, not whether a stand-in is buildable.
- **The three Gtk layout containers on NativeScript** — `<gtk-aspect-frame>`,
  `<gtk-center-box>` and `<gtk-fixed>`. (`Gtk.Frame` and `Gtk.Grid` ship now.) They have browser
  elements and gallery blocks; the port has none of the three, so their stories are ledgered as
  not rendered there (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`) and
  their XML templates refused. They are the wrong SHAPE to translate one-for-one: the aspect
  frame's ratio, the centre box's three slots and the fixed's pixel offsets are all things
  `component-builder`'s two doors (a string attribute, a child) either cannot carry or carry
  with no arithmetic — `GtkBox` has no border-spacing a theme could style and `GtkLabel` no
  `baseline-position` to align against. `AbsoluteLayout` does cover `Gtk.Fixed` exactly, so
  whether these arrive as three widgets or as two styled boxes plus one `AbsoluteLayout` is the
  open question, not the platform half.
- **`<gtk-popover>`, `<gtk-popover-menu>`, `<gtk-popover-menu-bar>` and
  `<gtk-popover-bin>` on NativeScript.** All four exist on the browser with their gallery
  blocks, and all four are refused an XML template because the NativeScript port has no
  POPUP SURFACE to put a menu in. Its menus run through a button —
  `GtkMenuButton.menuModel`, and `GtkDropDown` documents the substitution it makes instead
  (`packages/nativescript-bridge/adwaita/src/widgets/gtk-drop-down.ts:19-21`): the platform
  `action()` sheet. That is a defensible phone idiom for a MENU, and it is the wrong answer
  for the other three: `Gtk.Popover` takes arbitrary content, `Gtk.PopoverMenu` needs the
  page stack a `GtkStack` would give, and `GtkPopoverMenuBar`'s whole behaviour is
  `set_active_item`'s click-opens / hover-selects rule (gtkpopovermenubar.c:126-163), which
  an action sheet cannot express at all — there is no bar to walk. So what is open is
  whether a NativeScript popup is a port at all or stays the sheet: a popover is POSITIONED
  (CSS `position`/`align`, no overflow flip in either renderer), and `@nativescript/core`
  has no positioned overlay that is not a modal. The dismissal machinery would come free —
  `PopoverState` and `resolvePopoverKey` are renderer-neutral (ADR 0089) — so the question is
  the surface, not the behaviour.
- **The scrolling widgets on NativeScript.** `<gtk-scrollbar>`, `<gtk-viewport>` and
  `<gtk-window-handle>` are browser elements with gallery blocks (`Gtk.ScrolledWindow` ships
  there now), and the NativeScript port has none of the three widgets, so their stories are ledgered as not
  rendered there (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`) and
  their XML templates refused. What is missing is the whole chain rather than one view: the
  browser gets a scrolling container, its scrollbars and the viewport under them out of
  `overflow: auto` plus two elements of its own, where `GtkBox` lays children out and
  nothing else, so there is nothing for a scrolled window to stand in for and nothing to
  drive a trough. The scrollbar is the sharpest of the three, because its geometry is
  `page_size / (upper - lower)` and its position `(value - lower) / (upper - lower -
  page_size)` — two different denominators that a NativeScript `ScrollView`'s own thumb
  does not expose. The titlebar handle is the odd one out and is here because it is on the
  same page: a `Page` cannot be dragged by a view inside it, so the gesture has no host
  there at all.
- **`<gtk-flow-box>` and `<gtk-calendar>` on NativeScript.** (`Gtk.ListBox` ships now, with
  its rows, `selection-mode` and `row-activated`.) The two
  browser elements and their gallery blocks exist, and the SELECTION half is portable and
  renderer-neutral already — `listBoxSelect` and its three siblings in `@gjsify/adwaita-core`
  are `gtk_list_box_update_selection_full` line for line (ADR 0089), which is also
  `gtk_flow_box_update_selection`, and their vector tables run from the core suite AND from
  both browser specs. What the NativeScript port has is `GtkBox` (a `StackLayout`) and
  `AdwWrapBox` (a `FlexboxLayout`), so the wrap's CHILDREN have somewhere to go and its SELECTION does not: a wrap holds no state per cell. The calendar is further out —
  `@nativescript/core` ships no `DatePicker`, so there is nothing to take a day, a month grid,
  a marked day or the four navigation arrows from. Their stories are therefore ledgered as not
  rendered there (`NOT_ON_THIS_TARGET` in `scripts/check-storybook-story-parity.mjs`) and their
  XML templates refused. The open question for the flow box is whether the Adwaita
  EXPRESSION — four `Gtk.SelectionMode` values and a selected cell on a touch target — is the
  one this port wants at all, which the list box already answered; for the calendar it is whether a platform date picker counts as an Adwaita calendar,
  which `<adw-combo-row>` and `GtkDropDown` already decided for a LIST of values and not for a
  date.
- **`page` (Gtk.Notebook / Gtk.Stack pages) on the shared node shape.** `SharedTreeNode.page`
  (`{ label?, name? }`) is built by `gtk-host` (`layout` `tabLabel`, or `name` and `title`) and by
  `adwaita-web` (`tab-label`, or `name` and `title`), and refused BY NAME by `adwaita-nativescript`:
  there is no NS widget yet for `Gtk.Notebook` (a TabView owns its own tab strip), while `Gtk.Stack` and `Gtk.StackPage` ship there. When ADR 0093's `./capabilities` tables land,
  `page` becomes a row in each: gtk-host `implemented`; web `implemented`; nativescript
  `{ refused: 'no NS widget yet' }` for Notebook, and Stack is `implemented` too. It also
  needs a `CONSTRUCT_VECTORS` entry and a line in `check-construct-capabilities.mjs`; until then the
  three builder specs hold it. The gallery's `ADWAITA_GALLERY_REFUSALS` reasons should reuse those
  tables instead of restating them.
- **Storybook reuse of the gallery trees (scoped, not built).** Stories author their widget
  imperatively in `initialize()` (`packages/framework/adwaita-app/stories/*.story.ts`), the gallery
  trees are data in `scripts/adwaita-gallery-trees.mjs`. The seam is a `StoryWidget` method that
  calls `buildSharedTree` (`@gjsify/gtk-host/conformance`) and passes the root to `addContent()`.
  Blockers: the trees are `scripts/*.mjs`, not a published module, so they must move into a package
  first; the `layout` field has no counterpart in `addContent()`; stories with arg-bound
  `updateArgs()`, signals or a `.blp` template do not fit, nor do the blocks in
  `ADWAITA_GALLERY_TREE_DIVERGENCES`. Start with the static, argument-free stories.
- **Previews from the tree for the other families (audited, not convertible mechanically).** Arm 14
  of `check-website-adwaita-gallery.mjs` run against every block that has a tree and a hand-written
  preview (48 blocks) fails on 45; only Gtk.Stack, Gtk.Notebook and Adw.EditableLabel agree. The
  cause is vocabulary, not carelessness: `ADWAITA_GALLERY_TREES` is in `gtk-host` spelling
  (`placeholder-text`, `active`, `adjustment` as an object) while the web previews use the element
  spellings (`placeholder`, `checked`, a JSON string). A tree-to-markup rewrite was tried and produced
  `adjustment="[object Object]"`, so it was dropped. Only 7 blocks have one tree for both renderers
  (`ADWAITA_GALLERY_SHARED_TREES`) and 17 more are ledgered in `ADWAITA_GALLERY_TREE_DIVERGENCES`.
  The way forward is to mount the tree with `buildSharedTree` as one-Blueprint blocks already do
  and drop the `preview` fence of each converted block; the property spellings the trees and the
  elements disagree on (not yet counted: `check-vocabulary-alignment.mjs` is green and its "99
  failing vectors" are its own self-test inputs, not open gaps) are settled per block on the way. Notebook and Stack went first because their
  `page` vocabulary was new and aligned from the start.

When an issue is opened for one of these, its ledger entry points at `#<number>`
instead and the bullet is deleted from here.


### Platform interfaces a shared component class reaches for have no portable form yet

The report (`node scripts/report-target-gap.mjs <project-dir>`) lists the `gi://` members an app
uses that a port cannot answer. The choice order for each is a web standard, then a `gi://` API
ported into the two renderers, then a capability package like `@gjsify/system-accounts` (ADR 0095).
The names below are proposals: `Gio.SimpleAction` / `Gio.ActionGroup` through a `Gio` renderer
namespace bound to `action-name` (both ports already export a `Gio` barrel, and NativeScript
carries `SimpleAction` in it, but `GI_RENDERERS` routes no `gi://Gio` to either); the
`Adw.StyleManager` / `Gtk.Settings` color-scheme singleton (the browser does not use it yet, see
the color-scheme entry in `adwaita-web.md`); `Adw.Toast` `timeout` in one unit (see the
`AdwToastOverlay` entry above); application settings and a file chooser as capability packages;
and `navigator.clipboard` answered on GJS and NativeScript, so the app writes the web call
everywhere.
