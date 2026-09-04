# 46. A list is a value — but only for the widgets GTK gives a `model`

- Status: **Proposed**
- Date: 2026-09-04
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md), [ADR 0042 (portable menu model)](0042-portable-menu-model.md)

## Context

ADR 0042 gave the MENU a portable value. This is its sibling for the LIST, and the
measurement that produced it (#1524) says the two are not the same job — so this ADR is
deliberately narrower than "a portable `Gio.ListModel`".

The divergence is real and larger than the menu's by every yardstick that justified
ADR 0042: more vocabulary-ledger entries are list-shaped than menu-shaped, more gallery
refusals are list-shaped than menu-shaped, and the NativeScript renderer carries an order
of magnitude more collection properties than menu ones. (Every one of those figures is
printed at run time by `scripts/check-vocabulary-alignment.mjs`,
`scripts/check-generated-website-data.mjs` and
`scripts/check-adwaita-collection-reactivity.mjs`; #1524 carries them as they stood at
`0ef1d7c137`. None is restated here, because a figure copied into prose is the one that
drifts.)

But `Gio.MenuModel` is a WRITABLE PROPERTY on thirteen GTK widget interfaces, and a list
`model` property exists on **five** — `AdwComboRow`, `GtkDropDown`, `GtkColumnView`,
`GtkGridView`, `GtkListView` (`packages/framework/gtk-host/src/generated/props.ts`, whose
header carries the library versions it was generated from). For the widgets that carry
most of the divergence — Sidebar, TabView, ToggleGroup, ViewStack, Carousel — GTK has NO
item property at all: the collection is `adw_sidebar_append()`, `adw_tab_view_append()`,
`adw_toggle_group_add()`. One abstraction cannot span both, and inventing a model type for
the method-built half would put a GTK word on a value GTK does not have.

Two smaller facts shaped the scope as much as that one:

- **The item vocabulary was never the problem for the model-shaped widgets.**
  `AdwComboOptionInput` is already accepted by `@gjsify/adwaita-web`,
  `@gjsify/adwaita-nativescript` and `@gjsify/adwaita-react-native` — the last of which
  says so in its own `props.ts`. #1524 counted six spellings of "an item" in
  `@gjsify/adwaita-core`; five of them belong to the METHOD-BUILT widgets this ADR does not
  cover. So the vocabulary work here is to give that one type a home and a name for the
  list it forms, not to invent a seventh spelling.
- **What every collection in this package lacked was a positional change signal.**
  `ComboState.setOptions` reported only that the SELECTION may have moved, so both browser
  selectors answered a model assignment by dropping every option node and building them
  again. `TabViewState` was the sole exception, and its `TabViewPagesChange` is the
  evidence for the shape a renderer actually needs.

## Decision

### 1. Scope is the widgets GTK gives a `model` property, and nothing else

Two of the five have a port widget: `Adw.ComboRow` and `Gtk.DropDown`. `GtkListView`,
`GtkGridView` and `GtkColumnView` have no widget on any renderer here, so nothing about
them is decided; `AdwDataGrid` is OURS rather than a port of `Gtk.ColumnView`, and keeps
its own row type.

The method-built widgets get NO model type. Their gallery refusal is
`uncurated-placement` — a `packages/framework/gtk-host/src/descriptors/` gap, which
`scripts/adwaita-gallery-trees.mjs` already says is "a property of the descriptor table on
`main`, not of the widget" — and a portable model would not unblock a single one of them.
That half is filed in `status/open-todos.md` with its measurement rather than half-built.

### 2. The item vocabulary keeps its published names, and moves to one module

`packages/web/adwaita-core/src/list.ts` owns `AdwComboOption`, `AdwComboOptionInput`,
`normalizeComboOptions` and `ADW_COMBO_NO_SELECTION`, which moved there from `rows.ts` and
are re-exported from it, so neither import path changed.

They are NOT renamed. Three of the four surfaces already accept that type, and a
`AdwListItem` beside it would be exactly the extra spelling this exercise exists to remove
— the trap ADR 0034 spent a cycle undoing one widget name at a time. What IS new is a name
for the LIST those items form, because that is what the property holds and no surface had a
word for it: `AdwListModel` (normalised) and `AdwListModelInput` (what a setter accepts).

### 3. The positional change signal is `GListModel`'s own, not ours

```ts
interface AdwListItemsChanged { position: number; removed: number; added: number }
```

`Gio.ListModel::items-changed (position, removed, added)` — read off the GIR type surface
in `@girs/gio-2.0`, because `refs/gtk` and `refs/gjs` are EMPTY in this tree and
`ComboState.hasIndex` already records that same limit in place. `listItemsChanged(previous,
next)` computes the ONE minimal splice between two models — shared prefix and shared suffix
kept — which is `g_list_store_splice`'s shape and its stated reason: it "only emits
items-changed once for the change".

WHAT arrived is deliberately absent from the signal, as it is in GLib: a consumer re-reads
the model over `[position, position + added)`. Carrying the items would make the signal a
second copy of the model that can disagree with it.

Two items compare by BOTH halves. A descriptor whose label changed at an unchanged value is
a different thing to draw, so it falls inside the range; comparing by `value` alone would
leave a renamed row showing its old text, which is what `selection_item_changed` exists for
upstream.

`ComboState` gains a second subscription for it (`subscribeItems`), rather than a field on
`ComboStateChange`. Two signals because they answer different questions and a renderer needs
both — `Adw.ComboRow` gets exactly this pair from GTK, `notify::selected` plus
`items-changed` on the model it holds. The splice is emitted BEFORE the selection change,
which is the ordering that lets the selection subscriber's index write land on item views
that already exist; `<adw-combo-row>` used to carry that hazard as a comment ("AFTER the
rebuild, never during it").

### 4. `TabViewPagesChange` is not replaced — it is MAPPED, and the mapping is measured

`tabViewItemsChanged(change)` folds the five kinds onto the three numbers: attached is
`(p, 0, 1)`, detached `(p, 1, 0)`, updated `(p, 1, 1)` — which is how `GListModel` spells a
per-item change, having no other verb — and reordered/pinned the span between the two
positions, removed and re-added, which is how `g_list_store_move` reports a move.

The published `TabViewPagesChange` shape is untouched. `AdwTabView` is a METHOD-BUILT
widget, so § 1 keeps it out of the model half; what it contributes is the proof that a
positional signal is the right shape, and the mapping is what turns "it is the same signal"
from a sentence into a test. Both renderer tab-view suites replay the changes THEIR real
widget emitted through `replayTabPagesAsSplices` and compare the result against the page
order that widget ended on.

### 5. One name on every surface: `model`

`Adw.ComboRow:model` and `Gtk.DropDown:model` are the GObject properties' own names, so
ADR 0034 clause 1 decides it. `model` replaces `options` and `items` on the browser
elements (property AND attribute) and `options` on the NativeScript widgets;
`@gjsify/adwaita-react-native` already spelled it `model` and now takes the shared
`AdwListModelInput` for it. `ComboState.setOptions`/`options` become
`setModel`/`model` for the same reason.

This is the ADR 0034 clause the menu ADR applied to `menuModel`, applied to the other
property `coerce` will one day have to bridge. The two vocabulary-ledger entries that named
the divergence are deleted, and the distance the ledger prints goes down by them.

`options` and `items` are NOT kept as aliases. The published-alias precedent in that ledger
(`adw-password-entry-row.peeking`) exists because NEITHER name is in the C; here one of them
is, and keeping the other two would leave three spellings of one GTK property — while an
entry that stays in the ledger is a distance that never closes.

### 6. Selection stays where it is; only its RULE moves

`ComboState` remains the selection, because a list model is not a selection model —
`Gtk.ListView:model` is a `Gtk.SelectionModel` precisely because GTK keeps the two apart,
and `@gjsify/gtk-host`'s `ListController` has to wrap its store in `Gtk.NoSelection` for
that reason.

What moves is the one rule a second list widget would otherwise re-derive:
`clampListSelection(selected, length)`, `GtkSingleSelection`'s autoselect after a model
replacement. It was already cross-renderer conformance data — `conformance/rows.ts` carries
it as "the ports' shared answer" — and merely had no name.

### 7. No sorting, no filtering, no factories — and no `gtk-host` edge YET

Sorting: measured demand across all four surfaces is zero. Filtering exists on one widget
and its semantics are peculiar enough to tax everything else (`adw_sidebar_set_filter`
leaves the selection index space on the UNFILTERED model — two index spaces is a sidebar
rule, not a list rule). Virtualisation and item factories are `ListController`'s, on a
published subpath.

**And the GTK half is not built here.** ADR 0042 § 7 gave `@gjsify/gtk-host` a dependency
edge on `@gjsify/adwaita-core` and a `coerce` branch turning an authored array into a real
`Gio.Menu`. The list needs the same branch — an array into a `Gtk.StringList` — and it is
NOT in this change: `packages/framework/gtk-host/**` is being reworked concurrently, and a
speculative edit there would land as a merge conflict rather than as a feature. So the two
gallery blocks stay refused, with half their reason now gone: what is missing is no longer
a VALUE but the seam. `status/open-todos.md` carries it under "A portable list model
reaches every renderer except GTK", with what closes it.

## Consequences

- **BREAKING**, on three published packages. Verified against the names this workspace
  exports today:

  | published as | in | becomes |
  |---|---|---|
  | `ComboState.setOptions` / `ComboState.options` | `@gjsify/adwaita-core` | `setModel` / `model` |
  | `ComboSelectionStep` `{ op: 'setOptions', options }` | `@gjsify/adwaita-core/conformance` | `{ op: 'setModel', model }` |
  | `options` / `items` (property + attribute) | `@gjsify/adwaita-web` `<adw-combo-row>`, `<gtk-drop-down>` | `model` / `model` |
  | `options` (property) | `@gjsify/adwaita-nativescript` `AdwComboRow`, `GtkDropDown` | `model` |
  | `AdwComboRowProps.model?: readonly AdwComboOptionInput[]` | `@gjsify/adwaita-react-native` | `AdwListModelInput` — assignment-compatible, so no consumer edit |

  `AdwComboOption` and `AdwComboOptionInput` keep their names and their shape; only the
  module they are declared in moved, and `rows.ts` re-exports both.

- **The NativeScript setter accepts what the browser accepts.** It took descriptors only,
  so `model = ['a', 'b']` stored strings and every label read back `undefined`. It runs
  `normalizeComboOptions` now, like the other three surfaces. That fix is held by core's
  vectors and NOT by a NativeScript widget test: `drop-down.spec.ts` drives `ComboState`
  rather than the widget, for the reason its own header gives (importing the widget
  evaluates a bare `@nativescript/core` specifier, unresolvable on GJS/Node).

- **Both browser selectors splice instead of rebuilding**, and one latent defect came out
  with it: each drop-down row's click handler closed over the index it was BUILT at, which
  a full rebuild always refreshed. Under a splice it does not, so the handler asks the list
  where the row is now. `<option>` elements also stop carrying their POSITION as their
  `value` — nothing ever read it back, and it made every insertion renumber the whole tail.

- **`scripts/check-adwaita-collection-reactivity.mjs` gained two rules' worth of sight, and
  it is a fix rather than an accommodation.** Its own header carried a KNOWN LIMIT: the
  attribute reader looked for a literal `JSON.parse(` inside a class member, so a parser
  that MOVED into core took the attribute out of its sight. That limit came true here —
  `attr:model` went invisible on both selectors at the moment their rules were meant to hold
  it. `coreListParsers` now DERIVES core's string→list functions instead of listing them,
  which also brings both menu buttons under rules 2 and 3 for the first time and gives
  `<gtk-menu-button>` its first census entry. Two more defects in that reader surfaced while
  fixing it: a call on a NON-core receiver was credited to the single core class declaring
  that method name (`this._menuView.setModel(…)` made `<gtk-menu-button>` "carry"
  `SplitButtonState.setMenuModel`), and rule 3's list-setter test used a bare bracket
  match, so every setter whose parameter is a NAMED list alias — `AdwMenuInput`,
  `AdwListModelInput` — read as "list setters: [none]".

- **`PopoverMenuView.setModel` is `setMenuModel`.** Two methods called `setModel` over two
  unrelated values on one surface is the collision this whole exercise removes, and it is
  what the reader above resolves a collection call by. The class is not re-exported from
  `@gjsify/adwaita-web`'s barrel, so nothing published moves.

- **Cost.** One more module in `adwaita-core` with its conformance table, one more
  subscription on `ComboState`, and a splice path in each of the two browser selectors.

## What this does NOT decide

- **The method-built widgets.** Sidebar, TabView, ToggleGroup, ViewStack and Carousel keep
  their own collection shapes. The fix for their gallery refusals is a curated descriptor
  using the `ChildPolicy` kinds that already exist, not a model type.
- **`coerce` for a list.** § 7. Until that branch exists, `Adw.ComboRow` and `Gtk.DropDown`
  have no dialect snippet in the gallery.
- **Selection as a portable MODEL.** `Gtk.SelectionModel` is a second interface layered on
  the first, and nothing here needs the layering — one selected index is what all four
  surfaces have.
- **`ListController`.** `@gjsify/gtk-host/list` is a published subpath and
  `setRows(rows: readonly Row[])` is the one framework-neutral seam where a collection
  crosses into GTK. It is untouched; widening it to accept `AdwListModel` is part of the
  `coerce` question above, not separate from it.

## Implementation

1. `packages/web/adwaita-core/src/list.ts` — the item vocabulary (moved), the model type
   names, the total attribute parser, the selection clamp, `AdwListItemsChanged` and
   `listItemsChanged`; `conformance/list.ts` — five vector tables plus
   `replayTabPagesAsSplices`.
2. `ComboState` — `setModel`/`model`, `subscribeItems`, the clamp delegated.
3. `tab-view.ts` — `tabViewItemsChanged`, driven from both renderer tab-view suites.
4. `@gjsify/adwaita-web` — `model` on both selectors, `parseListModel` for the attribute,
   a splice path in each, `PopoverMenuView.setMenuModel`.
5. `@gjsify/adwaita-nativescript` — `model`, normalising.
6. `@gjsify/adwaita-react-native` — `AdwListModelInput` on `AdwComboRowProps`.
7. `scripts/check-adwaita-collection-reactivity.mjs` — the derived parser set, the receiver
   resolution with its one forwarding hop, the alias-aware list-setter test, the census.
8. `scripts/check-vocabulary-alignment.mjs` — the two retired entries.
