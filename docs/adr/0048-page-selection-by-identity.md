# 48. A selection takes the shape its counterpart gives it: a name, a page, or an ordinal

- Status: **Proposed**
- Date: 2026-09-05
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md), [ADR 0042 (portable menu model)](0042-portable-menu-model.md), [ADR 0046 (portable list model)](0046-portable-list-model.md), [ADR 0047 (portable adjustment)](0047-portable-adjustment.md)

## Context

ADRs 0042, 0046 and 0047 each gave one thing a portable VALUE — a menu, a list, a range.
This one is different in kind and it is worth saying so first, because the obvious reading
of it is wrong: **there is no portable selection value to introduce.** The value already
exists on every surface. What diverged is which of GTK's own shapes each port picked.

GTK offers three, and it picks between them per widget. Measured against
`packages/framework/gtk-host/src/generated/props.ts`, the in-repo GIR-derived surface:

| the shape GTK gives the selection | the types that have it |
|---|---|
| identity, by NAME — `visible-child-name` | `AdwLeaflet`, `AdwViewStack`, `GtkStack` |
| identity, by OBJECT — `selected-page` | `AdwTabView` |
| ORDINAL — `selected: number` | `AdwComboRow`, `AdwSidebar`, `GtkDropDown` |

The split is not an accident of history. A `GtkDropDown` selects a row of a `GListModel`,
where a position IS the identity the model exposes; an `AdwViewStack` selects one of a set
of NAMED pages, and a `GtkStack` page's name outlives an insertion before it. So an ordinal
is right where the model is a list, and wrong where the pages have names of their own.

**The port took the ordinal in the two places GTK names an identity**, and both renderers
took it the same way:

| widget | `@gjsify/adwaita-nativescript` | `@gjsify/adwaita-web` | `@gjsify/adwaita-react-native` | GIR |
|---|---|---|---|---|
| `AdwViewStack` | `visibleChildIndex` (settable) beside `visibleChildName` | the same pair | `visibleChildName` only | `visible-child-name` |
| `AdwTabView` | `selected` (settable ordinal) | the same | — | `selected-page` |

Two things follow from that table and both shaped this decision.

**React Native is the control.** It carries a view stack and no ordinal door — its
`visibleChildName` prop is the only way in, written that way from the start
(`view-stack.native.tsx:65`). So the converged shape is not a proposal here; it is already
shipping on a third renderer, and this ADR brings the older two to it rather than inventing
anything.

**The three ordinal widgets are already right and are deliberately untouched.**
`adw-sidebar.selected`, `gtk-drop-down.selected` and `adw-combo-row.selected` name the same
slot their counterpart names, in the same shape. A rule reading "identity always wins"
would have broken all three, which is how a convergence programme starts producing
divergence — the rule is *take the counterpart's shape*, and this ADR is one application
of it.

### What an ordinal DOOR costs, beyond disagreeing with the GIR

The ordinal is derived, and `ViewStackState` already contains the code that proves it:
inserting a page before the visible one increments the stored index
(`view-stack.ts:296`), a reorder rewrites it (`:322`), a removal decrements it (`:348-349`).
Every one of those lines exists so that a NUMBER a caller is holding does not silently come
to mean another page. A name needs none of them — it survives all three operations
unchanged. An ordinal is therefore safe to READ, at a moment, and unsafe to hold; a
settable property invites exactly the holding.

## Decision

**An ordinal is a report. Identity is the door.**

### 1. `AdwViewStack`: the settable ordinal becomes a call

`visibleChildIndex` loses its setter on `@gjsify/adwaita-nativescript` and
`@gjsify/adwaita-web`. The GETTER stays on both, unchanged: "which position is selected
right now" is a legitimate question, it is what a switcher bar renders, and
`notify::visible-child` already carries `index` in its payload for the same reason.

Selecting is `visibleChildName`, which both renderers already have and which is
`Adw.ViewStack`'s own property — **or `selectNthPage(n)`, which is new.** A method rather
than a property because the difference is the holding: a call resolves against the page
list as it is at that moment and keeps nothing, while a property invites a caller to hold
a number that later means another page.

**It is port-owned as a SETTER, and the reference is more precise than that**: neither
`refs/libadwaita/src/adw-view-stack.h` nor `adw-tab-view.h` declares a function that
SELECTS by position — `select_previous_page` / `select_next_page` are the only relative
moves. An ordinal is not absent from either, though, and pretending it is would make the
weaker argument:

- `adw_tab_view_get_nth_page (AdwTabView *self, int position)`
  (`refs/libadwaita/src/adw-tab-view.h:192#adw_tab_view_get_nth_page`) is a public ordinal
  ACCESSOR.
- `select_nth_page_cb` (`refs/libadwaita/src/adw-tab-view.c:2137#select_nth_page_cb`) is
  libadwaita's OWN ordinal selection — the
  Alt+1…Alt+9 / Alt+0 shortcut — and it is exactly this composition:
  `adw_tab_view_get_nth_page()` then `adw_tab_view_set_selected_page()`. Private, because a
  shortcut handler is not API.
- both widgets hand out a `GtkSelectionModel`
  (`refs/libadwaita/src/adw-view-stack.h:166#adw_view_stack_get_pages`;
  `refs/libadwaita/src/adw-tab-view.h:268#adw_tab_view_get_pages`), and selection on one is
  positional.

So `selectNthPage` is not an ordinal libadwaita refuses; it is the ordinal libadwaita
performs, promoted from a private shortcut handler to a method, and named for the
`selectNthPage` the tab view has carried all along so that the two widgets ask the same
question the same way. What stays port-owned is putting it in the public surface.

Without it the translation is `stack.pages[n]?.name`, and the first draft of this change
wrote that line **three times** across the two switcher bars — the copied-arithmetic smell
[ADR 0047](0047-portable-adjustment.md) found in `AdwSliderRow`, arriving in the same
change that was supposed to reduce it. One method, three call sites, no copies.

And that is the weaker half of the case. `pages[n].name` is not a translation of
`selectNthPage(n)` at all for two page shapes the specs already pin: a page whose name is
`''` cannot be selected by name (`view-stack.spec.ts:226` — the reflection guard never
fires for it), and where two pages share a name a lookup resolves to the FIRST
(`:252`, written against exactly that bounce). A switcher bar renders button *n* over
whatever pages the stack holds, duplicates and blanks included, so for those two it has no
name to pass. The method is not a convenience over the name; it is the only door onto the
pages the name cannot reach.

### 2. `AdwTabView`: `selected` becomes `selectedPage`, and it holds an identity

`selected` — a settable ordinal on both renderers — is replaced by `selectedPage`, which is
`Adw.TabView`'s own property name and, as there, an IDENTITY rather than a number. The core
already models exactly this (`TabViewState.selectedPage`), so the renderers expose a value
that existed and was not reachable from the outside except through a method.

**The two renderers write it in different shapes, and that is a decision** (ADR 0034 § 1
clause 3: a divergence is declared, with its reason — the clause the phrase "converges in
name, never in shape" belongs to is `composes`, which is about a widget assembled
differently from its GIR counterpart, not about two renderers differing from each other;
and the vocabulary ledger compares property NAMES, so nothing measures this either way):

| | reads | writes | why |
|---|---|---|---|
| `@gjsify/adwaita-web` | the page | the page | its DOM has a page ELEMENT, and its markup door carries the id separately as `selected-page` |
| `@gjsify/adwaita-nativescript` | the page | the page's **id** | an id already IS the page handle on that port (`isClosing`, `closePage`, `setPagePinned` all take one) and an XML attribute can carry nothing else — § 3 |

The cost is on the NativeScript half and is deliberate: the two accessors have unrelated
types, which TypeScript has allowed since 5.1, so `view.selectedPage = view.selectedPage`
is a TYPE ERROR rather than a silent one. The alternative — `AdwTabPage | string | null` on
the setter, which is what the core takes — makes the round-trip legal but is currently
classified `json` by `check-nativescript-xml-doors` and turns the door red; that gate defect
is in `status/open-todos.md`, and it is the thing to fix before revisiting this.

`selectedIndex` and `selectedId` stay as the getters they already are. Neither is a door.

### 3. On the web, the MARKUP door names the page too

`<adw-tab-view selected="1">` becomes `<adw-tab-view selected-page="<page id>">`, reflected
on every selection change as the ordinal was.

Markup cannot hold an object, so the attribute holds the page's **id** — the one
`<adw-tab-page page-id>` already declares, and the reason that attribute exists. A page
that declares none gets a generated id, which an author cannot predict and therefore cannot
select by; that is the same bargain `<adw-view-stack visible-child-name>` has always made
for a page with no name, and it is why the parse rule is *ignore an id no page holds*
rather than *fall back to the first page*.

Ignored, and RECORDED: the refusal goes through `setSelectedPage`, so an id no page holds
appends C's `page_belongs_to_this_view` assertion to `view.diagnostics`, where the ordinal
attribute refused an out-of-range index in silence. The selection is the same either way;
what changes is that the typo is now visible to anyone reading the diagnostics.

`@gjsify/adwaita-nativescript` needs its own equivalent, because there the property IS the
XML door and a property holding an object is not one. The first draft of this ADR gave it
none and the loss was measurable: `selectedPage` landed in "typed as something no XML
attribute can carry" and `AdwTabView` was left as the one XML-reachable class with a
selection and no string-typed setter for it, where `<AdwTabView selected="1">` had worked
through `xmlNumber`. So the setter there takes the ID — `<AdwTabView selectedPage="inbox">`
— which is § 2's asymmetry and its reason.

Measured with `check-nativescript-xml-doors`, whose string-door counter was added for this
claim, because "classified `string`" and "the reader never saw it" printed identically
before it:

| | coercing non-string | string, carried as-is | XML cannot carry |
|---|---|---|---|
| before this ADR | 66 | 70 | 19 |
| with an object-typed `selectedPage` | 64 | 70 | **20** |
| as it stands | 64 | **71** | 19 |

`selected` and `visibleChildIndex` left the numeric bucket and `selectedPage` joined the
string one: two XML doors removed, one added, and no setter left in the bucket an attribute
cannot reach.

### 4. The core keeps its ordinal API, and that is the point of the split

`ViewStackState.setVisibleIndex` and `TabViewState.selectNthPage` are unchanged, and the
conformance vectors that drive them (`selectIndex` ops in
`@gjsify/adwaita-core/conformance/view-stack`) are unchanged with them.

A switcher bar IS ordinal: it renders button *n* and must select page *n*. That translation
belongs where the ordinal is a fact about a rendered list, not on the widget's public
surface where it is a promise about a page. So the two switcher bars translate through
`pages[n].name`, which is one lookup and is what makes the promise true.

## Consequences

- **Breaking**, on two published packages. `stack.visibleChildIndex = 2` becomes
  `stack.selectNthPage(2)` (or `stack.visibleChildName = '…'`), and `view.selected = 2`
  becomes `view.selectNthPage(2)` — a method both tab views already had — or
  `view.selectedPage = page`. Every migration is one line and mechanical.
- **A PROPERTY write fails loudly; an ATTRIBUTE write does not.** The removed setters were
  the only writable properties of their name, so an unmigrated `stack.visibleChildIndex = 2`
  is a TypeScript error and, at runtime, a no-op on a getter. Three other doors have no such
  backstop and each one was measured going silently dead:
  - `view.setAttribute('selected', String(n))` on the web element. `website/` had TWO —
    `CommandTabs.astro` (the npm/yarn/gjsify tabs, restored from `localStorage` and mirrored
    across the page) and `AdwWidget.astro` (every gallery block's implementation tabs) —
    which the first draft of this ADR recorded as none, because it grepped the PROPERTY
    names. Both are migrated with this change, and `check-website-attr-samples.mjs` arm 4
    now follows a binding taken from a custom-element selector to its `setAttribute` calls,
    which is the reason this was ever findable by anything but a reader clicking a tab.
  - `<AdwTabView selected="1" />` and `<AdwViewStack visibleChildIndex="2" />` in
    NativeScript XML, which no type sees at all.
- **XML doors DID change**, contrary to the first draft of this section, and the final shape
  is not the one that draft described either. Measured with `check-nativescript-xml-doors`:
  coercing non-string setters 66 → 64 (both numeric doors gone), string doors 70 → 71
  (`selectedPage` is one now), setters XML cannot carry 19 → 19 (it passed through 20 while
  the setter took the object). Two doors removed, one added, none left half-reachable.
- The vocabulary ledger loses two `should converge` property entries. That is the metric
  moving because the thing it measures moved: `check-vocabulary-alignment.mjs` counts
  SETTABLE properties, because a door is what a portable authored tree writes. Measured:
  143 → 142 settable, 107 → 108 agreeing, distance 7 → 5 property names.
- **A refusal that was silent is now RECORDED**, on the web element and on both renderers'
  tab views. `selected = 99` went through `selectNthPage`, which refuses an out-of-range
  index and pushes nothing; an unknown `selected-page` id and `selectedPage = null` with
  pages present both go through `setSelectedPage`, which is where C's
  `page_belongs_to_this_view` and `ADW_IS_TAB_PAGE` assertions live. The selection outcome
  is unchanged — both are refused — but `view.diagnostics` grows an entry where it did not.
  That is the right answer (a typo'd id in markup is exactly what C would `g_critical`
  about) and it is asserted in `tab-view.spec.ts`, not left to be discovered.
- Nothing in `showcases/`, `packages/framework/stories` or the generated NativeScript
  templates writes either property, which is why this ADR proposes a removal rather than a
  deprecation. `website/` did — see the second bullet.

## What this does not decide

- **`visible-child` (the widget) is not added.** `Adw.ViewStack` also selects by CHILD
  WIDGET, and neither renderer offers that. It is a third door onto the same slot and
  nothing has asked for it; the ADR that adds it should say what it is for.
- **`AdwLeaflet` and `GtkStack` are out of scope** — neither renderer ports them today.
  When one does, the table above is the rule it inherits.
- **Ordinal REPORTS elsewhere are untouched**, including every `selected` on the three
  widgets whose counterpart is ordinal.
- **`setSelectedPage` takes the PAGE now, and an id as well** — widened in the core rather
  than guarded in each renderer, because the identity check `page_belongs_to_this_view` can
  only be answered where the page list lives. A renderer-side guard was written first and
  measured wrong twice over: it is two copies, and its refusal is silent where C raises a
  diagnostic. The remaining id-taking methods — `isClosing`, `closePage`, `setPagePinned` —
  are unchanged and stay in `status/open-todos.md`; libadwaita takes an `AdwTabPage *` in
  every one, and settling them together is a decision this ADR does not need to make.
