// The portable list model — the ITEM vocabulary plus `GListModel`'s own change
// signal, in plain data (ADR 0046).
//
// This is the sibling of `menu.ts`, and it is deliberately NARROWER. A `GMenuModel` is a
// writable property on thirteen GTK widget interfaces, so one portable value reached all
// of them. A list `model` property exists on FIVE — `AdwComboRow`, `GtkDropDown`,
// `GtkColumnView`, `GtkGridView`, `GtkListView` (`gtk-host/src/generated/props.ts`, whose
// provenance line names the libraries it was read from). For the widgets that carry most
// of the divergence — Sidebar, TabView, ToggleGroup, ViewStack, Carousel — GTK has NO
// item property at all: the collection is built by `adw_sidebar_append()`,
// `adw_tab_view_append()`, `adw_toggle_group_add()`. Inventing a model type for those
// would put a GTK word on a value GTK does not have, so this module does not.
//
// THE ITEM VOCABULARY IS NOT NEW, AND THAT IS THE POINT. `AdwComboOption` and
// `AdwComboOptionInput` are already accepted by three of the four surfaces
// (`@gjsify/adwaita-web`, `@gjsify/adwaita-nativescript`, `@gjsify/adwaita-react-native`,
// the last of which says so in its own `props.ts`). They moved HERE from `rows.ts` and
// kept their published names: a fifth spelling of "an item" is what this module exists to
// remove, and renaming the one type that already spans the surfaces would have been it.
// `rows.ts` re-exports them, so neither import path changed.
//
// WHAT IS NEW IS THE CHANGE SIGNAL. Every collection in this package answered a mutation
// with a full rebuild — `ComboState.setModel` notified only that the SELECTION may have
// moved, and both browser selectors responded by dropping every option node and building
// them again. `TabViewState` was the one exception, and its `TabViewPagesChange` proved
// the shape a renderer needs: WHERE the collection changed, so it can touch that part and
// leave the rest standing. The portable form of that is not ours to invent —
// `Gio.ListModel::items-changed (position, removed, added)` is GLib's own, and
// `g_list_store_splice` documents the reason in one sentence: it "only emits
// items-changed ONCE for the change". {@link listItemsChanged} computes that one splice.
//
// PROVENANCE, STATED BECAUSE IT IS THINNER HERE THAN IN `menu.ts`. `refs/gtk` and
// `refs/gjs` are EMPTY in this tree, so no C is quotable for `GListModel` or
// `GtkSingleSelection` — the same limit `ComboState.hasIndex` already records in place.
// The signal's arity and its parameter meanings are read off the GIR type surface
// (`@girs/gio-2.0`, `Gio.ListModel.items_changed(position, removed, added)` and
// `Gio.ListStore.splice(position, n_removals, additions)`), which is a generated
// description of the real library and is what this repository has. Nothing below claims a
// C line it did not read.
//
// PLATFORM-NEUTRAL: pure data and pure functions. Building a real `Gio.ListModel` is the
// GTK renderer's half and is NOT here — see ADR 0046 § 7 for why that edge is not drawn
// yet.
//
// Copyright (c) GNOME contributors (GLib/GTK). LGPLv2.1+.

/** One selectable item — the display text plus the value it is addressed by. */
export interface AdwComboOption {
    /** Display label shown in the row + chooser. */
    label: string;
    /** Underlying value the item is addressed by. */
    value: string;
}

/**
 * What an author may write for one item before {@link normalizeComboOptions} has seen it:
 * a bare string (value === label, the `Gtk.StringList` case), or a partial descriptor
 * where either half may stand in for the other.
 */
export type AdwComboOptionInput = string | { value?: unknown; label?: unknown };

/** A normalised portable list model — what a `model` property holds on every surface. */
export type AdwListModel = ReadonlyArray<AdwComboOption>;

/** What a `model` property ACCEPTS: the widened form of {@link AdwListModel}. */
export type AdwListModelInput = ReadonlyArray<AdwComboOptionInput>;

/**
 * Raw authored items → the stable `{ value, label }` descriptors every list surface
 * works with.
 *
 * A bare string is both value and label (`Gtk.StringList`'s model, which is what
 * `Adw.ComboRow` is fed in the common case). In a descriptor either half stands in for the
 * missing other, so `{ label: 'Apple' }` is addressable by the value `'Apple'` rather than
 * by `undefined`. ONE home for the rule, so no two list widgets can accept two different
 * item vocabularies.
 *
 * TOTAL — it throws for no input. The doors this reaches are a property assignment and a
 * markup attribute, and an author's typo must not take the widget down.
 */
export function normalizeComboOptions(raw: AdwListModelInput | null | undefined): AdwComboOption[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
        if (typeof entry === 'string') return { value: entry, label: entry };
        const value = entry?.value === undefined ? String(entry?.label ?? '') : String(entry.value);
        const label = entry?.label === undefined ? value : String(entry.label);
        return { value, label };
    });
}

/**
 * The MARKUP door: a JSON attribute → the normalised model.
 *
 * Total in both of its failure modes, which are different things and both an author slip:
 * unparseable JSON and well-formed JSON that is not an array (an object, a number)
 * each yield the empty model. Neither may stop the element upgrading — the reasoning
 * `parseMenuModel` records for the same door on the same surfaces.
 *
 * It lives here rather than in each element because it was written twice, byte for byte,
 * in `<adw-combo-row>` and `<gtk-drop-down>`: the second copy is where a helper is lifted.
 */
export function parseListModel(raw: string | null | undefined): AdwComboOption[] {
    if (!raw) return [];
    try {
        return normalizeComboOptions(JSON.parse(raw) as AdwListModelInput);
    } catch {
        return [];
    }
}

/**
 * The "no item is selected" index — the TS mirror of `GTK_INVALID_LIST_POSITION`
 * (`AdwComboRow:selected`'s default and empty value).
 *
 * libadwaita spells it `G_MAXUINT` because the property is a `guint`; `-1` is the idiomatic
 * TS sentinel and the spelling {@link ADW_SIDEBAR_NO_SELECTION} uses for the same GTK
 * constant. Without it, an EMPTY model and a model whose first item has an empty label are
 * indistinguishable — both report index 0 with an empty value — so a renderer that wants to
 * draw a placeholder has nothing to test.
 */
export const ADW_COMBO_NO_SELECTION = -1;

/**
 * Where a selection lands after the model under it was REPLACED.
 *
 * `GtkSingleSelection` autoselects, so a position the new model does not have falls back
 * to 0 — including the sentinel, which is how a widget recovers a selection when its model
 * grows. An EMPTY model has no 0 to fall back to and lands on
 * {@link ADW_COMBO_NO_SELECTION}.
 *
 * The test is membership and not `selected >= length`: the sentinel is BELOW the range, so
 * a one-sided comparison leaves a `-1` in place and a model that was emptied and refilled
 * comes back with nothing selected.
 *
 * Lifted out of `ComboState.setModel` so a second list widget cannot re-derive it. The
 * cross-renderer rule it encodes was already conformance data — `conformance/rows.ts`
 * carries it as "the ports' shared answer" — it just had no name of its own.
 */
export function clampListSelection(selected: number, length: number): number {
    if (Number.isFinite(selected) && selected >= 0 && selected < length) return selected;
    return length === 0 ? ADW_COMBO_NO_SELECTION : 0;
}

/**
 * One positional change — `Gio.ListModel::items-changed`'s own three parameters.
 *
 * `position` is where the model changed, `removed` how many items went, `added` how many
 * arrived. WHAT arrived is deliberately absent, because that is GLib's contract too: a
 * consumer re-reads the model over `[position, position + added)`. Carrying the items
 * would make the signal a second copy of the model that can disagree with it.
 */
export interface AdwListItemsChanged {
    /** The position at which the model changed. */
    readonly position: number;
    /** The number of items removed at {@link position}. */
    readonly removed: number;
    /** The number of items added at {@link position}. */
    readonly added: number;
}

/** Whether two normalised items address the same thing AND draw the same. */
function sameItem(a: AdwComboOption | undefined, b: AdwComboOption | undefined): boolean {
    return a !== undefined && b !== undefined && a.value === b.value && a.label === b.label;
}

/**
 * The ONE splice that turns `previous` into `next` — the `items-changed` a model
 * replacement should emit, or `null` when the two are equal and GTK would emit nothing.
 *
 * It is the minimal single range: the shared prefix and the shared suffix are kept, and
 * everything between them is the change. That is `g_list_store_splice`'s shape and its
 * stated reason — one emission per change rather than one per item — and it is what lets
 * a renderer append an item to a hundred-item list by adding ONE node.
 *
 * Items compare by BOTH halves: a descriptor whose label changed at an unchanged value is
 * a different thing to draw, so it is inside the range. Comparing by `value` alone would
 * leave a renamed row showing its old text, which is the exact failure `selection_item_changed`
 * exists for upstream.
 *
 * NOT a diff algorithm. A model that moves one item from the front to the back reports the
 * whole span, because `items-changed` has no vocabulary for a move — GTK's own list store
 * reports `g_list_store_move` the same way.
 */
export function listItemsChanged(
    previous: AdwListModel | null | undefined,
    next: AdwListModel | null | undefined,
): AdwListItemsChanged | null {
    const before = previous ?? [];
    const after = next ?? [];
    const shortest = Math.min(before.length, after.length);

    let position = 0;
    while (position < shortest && sameItem(before[position], after[position])) position++;

    let tail = 0;
    while (tail < shortest - position && sameItem(before[before.length - 1 - tail], after[after.length - 1 - tail])) {
        tail++;
    }

    const removed = before.length - position - tail;
    const added = after.length - position - tail;
    return removed === 0 && added === 0 ? null : { position, removed, added };
}
