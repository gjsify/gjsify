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

- **`<gtk-check-button>` and `<adw-radio>` on NativeScript.** The headless half already
  exists: `@gjsify/adwaita-core` carries `RadioGroupState` and `RADIO_GROUP_VECTORS`,
  driven today by core's own spec (`checks.spec.ts`) and the browser suite, by no
  NativeScript spec. What does not exist is the decision. `@nativescript/core` ships no
  checkbox view (nothing under its `ui/`), and libadwaita's own phone idiom for a
  boolean is `AdwSwitchRow`, which this port already has — so the question is whether
  a checkbox belongs on a touch target at all, not how to build one.
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
  buildable.
- **`adw-dialog` on NativeScript.** `AdwDialog` is a real upstream widget
  (`adw-dialog.h`) and the port has the three SPECIALISED dialogs — alert, about,
  preferences — but no generic one. Every NativeScript dialog here is deliberately the
  platform sheet ("There is NO custom in-app modal here", `adw-alert-dialog.ts`), and
  a content-agnostic dialog has no platform sheet to be. Whether it becomes an in-app
  card over the `AdwBottomSheet` overlay machinery, or is not offered at all, is the
  open decision.

When an issue is opened for one of these, its ledger entry points at `#<number>`
instead and the bullet is deleted from here.
