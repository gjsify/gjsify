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

**It is port-owned, and the reference says so**: `refs/libadwaita/src/adw-view-stack.h`
declares no ordinal API at all, and neither does `adw-tab-view.h` — `select_previous_page`
and `select_next_page` are the only relative moves there. So this is not GTK's shape being
restored; it is the port's own, named for the `selectNthPage` the tab view has carried all
along so that the two widgets ask the same question the same way.

Without it the translation is `stack.pages[n]?.name`, and the first draft of this change
wrote that line **three times** across the two switcher bars — the copied-arithmetic smell
[ADR 0047](0047-portable-adjustment.md) found in `AdwSliderRow`, arriving in the same
change that was supposed to reduce it. One method, three call sites, no copies.

### 2. `AdwTabView`: `selected` becomes `selectedPage`, and it holds the page

`selected` — a settable ordinal on both renderers — is replaced by `selectedPage`, which is
`Adw.TabView`'s own property name and, as there, holds the PAGE rather than a number. The
core already models exactly this (`TabViewState.selectedPage`), so the renderers expose a
value that existed and was not reachable from the outside except through
`setSelectedPage(id)`.

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

`@gjsify/adwaita-nativescript` needs no equivalent: its XML door is the property, and the
property now holds a page.

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
  `view.selectedPage = page`. Every migration is one line and mechanical, and none has a
  silent failure mode: the removed setters were the only writable properties of their name,
  so an unmigrated write is a TypeScript error and, at runtime, a no-op on a getter.
- The vocabulary ledger loses two `should converge` property entries. That is the metric
  moving because the thing it measures moved: `check-vocabulary-alignment.mjs` counts
  SETTABLE properties, because a door is what a portable authored tree writes.
- No XML door changes. `visibleChildIndex` and `selected` were reachable from NativeScript
  XML as numbers; `visibleChildName` is a string, which is what an XML attribute is anyway,
  and `selectedPage` holds an object, which XML cannot express and therefore never offered.
- Nothing in `website/`, `showcases/`, `packages/framework/stories` or the generated
  NativeScript templates writes either property — measured before writing this, which is
  why this ADR proposes a removal rather than a deprecation.

## What this does not decide

- **`visible-child` (the widget) is not added.** `Adw.ViewStack` also selects by CHILD
  WIDGET, and neither renderer offers that. It is a third door onto the same slot and
  nothing has asked for it; the ADR that adds it should say what it is for.
- **`AdwLeaflet` and `GtkStack` are out of scope** — neither renderer ports them today.
  When one does, the table above is the rule it inherits.
- **Ordinal REPORTS elsewhere are untouched**, including every `selected` on the three
  widgets whose counterpart is ordinal.
- **`setSelectedPage(id)` keeps its id parameter**, so the two renderers now offer the page
  through a property and its id through a method. libadwaita's own
  `adw_tab_view_set_selected_page()` takes the PAGE, so the method diverges from its
  counterpart in shape — but a method is not what a portable authored tree writes, the
  vocabulary ledger does not read one, and changing it is a second breaking change with no
  measurement behind it yet. It is written down in `status/open-todos.md` instead.
