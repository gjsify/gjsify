// Portable list-model conformance vectors — the spec every list surface is held to
// (ADR 0046).
//
// The rows are derived from two places and say which: the GIR type surface for what
// `Gio.ListModel::items-changed` MEANS (`@girs/gio-2.0` — `items_changed(position,
// removed, added)`, and `Gio.ListStore.splice(position, n_removals, additions)`, whose own
// documentation gives the reason for one emission per change), and this package's own
// published behaviour for what an item IS. `refs/gtk` and `refs/gjs` are EMPTY in this
// tree, so no C line is cited for either — `ComboState.hasIndex` records the same limit in
// place, and a citation nobody could have read is worse than none.
//
// WHAT EACH TABLE PINS DOWN, and the defect it exists for:
//
//   NORMALIZE       what an author may WRITE. A bare string is an item whose value is its
//                   label (`Gtk.StringList`'s own model); in a descriptor either half
//                   stands in for the other, so `{ label: 'Apple' }` is addressable by
//                   `'Apple'` and not by `undefined`. Four surfaces accept this vocabulary
//                   and NONE of them had a vector table for it — the normaliser was
//                   reachable from every combo scenario and asserted by none of them,
//                   because every step in `COMBO_SELECTION_VECTORS` hands over an
//                   already-normalised model.
//   PARSE           the same, through the JSON `model` ATTRIBUTE — the one door where a
//                   typo can reach the widget, so nothing here may throw. Both browser
//                   selectors wrote that parser out, byte for byte, before it moved to
//                   `parseListModel`.
//   ITEMS-CHANGED   WHERE a replacement changed the model: the single minimal splice, and
//                   `null` where GTK would emit nothing. `survivors` is the row's point —
//                   it is how many item views a renderer must NOT have touched, which is
//                   the difference between splicing and rebuilding and is invisible to
//                   any assertion about the model alone.
//   CLAMP           where the selection lands when the model under it is replaced.
//                   `GtkSingleSelection` autoselects, so a position the new model does not
//                   have falls to 0 — and the sentinel is BELOW the range, which is why
//                   the test is membership and not `selected >= length`.
//   TAB PAGES       the mapping from `TabViewPagesChange`, the one positional collection
//                   signal this package already had, onto the portable one. Each row
//                   carries the order BEFORE and AFTER, so "the three numbers plus the id
//                   are enough to replay the collection" is data rather than a claim.
//
// Copyright (c) GNOME contributors (GLib/GTK). LGPLv2.1+.

import type { AdwListItemsChanged, AdwListModel, AdwListModelInput } from '../list.js';
import { tabViewItemsChanged } from '../tab-view.js';
import type { TabViewPagesChange } from '../tab-view.js';

/** One {@link normalizeComboOptions} expectation. */
export interface ListNormalizeVector {
    input: AdwListModelInput;
    model: AdwListModel;
    rule: string;
}

/**
 * Authored input → the normalised model.
 *
 * Every surface that takes a `model` accepts this and must answer these rows: the browser
 * elements through their `model` property, the NativeScript widgets through theirs.
 */
export const LIST_NORMALIZE_VECTORS: ReadonlyArray<ListNormalizeVector> = [
    {
        input: ['Cyan', 'Magenta'],
        model: [
            { value: 'Cyan', label: 'Cyan' },
            { value: 'Magenta', label: 'Magenta' },
        ],
        rule: 'a bare string is both value and label — `Gtk.StringList`, which is what a combo row is fed in the common case',
    },
    {
        input: [{ value: 'a', label: 'One' }],
        model: [{ value: 'a', label: 'One' }],
        rule: 'a full descriptor passes through unchanged',
    },
    {
        input: [{ label: 'Apple' }],
        model: [{ value: 'Apple', label: 'Apple' }],
        rule: 'a label with no value is addressable BY that label — otherwise the item answers to `undefined` and `selectedValue` can never reach it',
    },
    {
        input: [{ value: 'k' }],
        model: [{ value: 'k', label: 'k' }],
        rule: 'a value with no label draws its value, so an item is never blank by omission',
    },
    {
        input: [{ value: 7, label: 42 }],
        model: [{ value: '7', label: '42' }],
        rule: 'both halves are stringified: the model is a string list on GTK, and a number that stayed a number would fail an === against the attribute it round-trips through',
    },
    {
        input: [{ value: '', label: 'blank' }],
        model: [{ value: '', label: 'blank' }],
        rule: 'an EMPTY value is a value — it is not missing, so the label does not stand in for it',
    },
    {
        input: [],
        model: [],
        rule: 'the empty model normalises to the empty model, which is the state a placeholder is drawn from',
    },
];

/** One {@link parseListModel} expectation — the JSON attribute door. */
export interface ListParseVector {
    /** The attribute value exactly as authored. */
    attribute: string;
    model: AdwListModel;
    rule: string;
}

/**
 * The `model` ATTRIBUTE → the normalised model. TOTAL: no row throws.
 *
 * An attribute is markup, parsed while the element upgrades, so a throw is reported as an
 * uncaught page error nobody can handle — the reasoning ADR 0042 § 6 records for the menu
 * attribute on the same elements.
 */
export const LIST_PARSE_VECTORS: ReadonlyArray<ListParseVector> = [
    {
        attribute: '["a","b"]',
        model: [
            { value: 'a', label: 'a' },
            { value: 'b', label: 'b' },
        ],
        rule: 'the string-array form, which is what markup writes in the common case',
    },
    {
        attribute: '[{"value":"a","label":"A"}]',
        model: [{ value: 'a', label: 'A' }],
        rule: 'the descriptor form',
    },
    {
        attribute: '[not json',
        model: [],
        rule: 'unparseable JSON is an author slip and yields the empty model — it must not stop the element upgrading',
    },
    {
        attribute: '{"a":1}',
        model: [],
        rule: 'well-formed JSON that is not an ARRAY is the second, different slip, and it answers the same way rather than throwing on `.map`',
    },
    {
        attribute: '',
        model: [],
        rule: 'an empty attribute is an empty model, not a parse attempt',
    },
];

/** One {@link listItemsChanged} expectation. */
export interface ListItemsChangedVector {
    previous: AdwListModel;
    next: AdwListModel;
    /** The single splice, or `null` where GTK would emit no signal at all. */
    change: AdwListItemsChanged | null;
    /**
     * How many item views a renderer must carry over UNTOUCHED — `previous.length` minus
     * what the splice removes. A rebuild scores 0 on every row with a non-zero figure
     * here, which is the whole difference this table measures.
     */
    survivors: number;
    rule: string;
}

const A = { value: 'a', label: 'A' };
const B = { value: 'b', label: 'B' };
const C = { value: 'c', label: 'C' };
const ABC: AdwListModel = [A, B, C];

/**
 * Model replacement → the one `items-changed` it emits.
 *
 * The shared prefix and the shared suffix are kept and everything between them is the
 * change, which is `g_list_store_splice`'s shape.
 */
export const LIST_ITEMS_CHANGED_VECTORS: ReadonlyArray<ListItemsChangedVector> = [
    {
        previous: [],
        next: ABC,
        change: { position: 0, removed: 0, added: 3 },
        survivors: 0,
        rule: 'the first assignment adds everything at 0 — there is nothing to carry over',
    },
    {
        previous: ABC,
        next: [...ABC, { value: 'd', label: 'D' }],
        change: { position: 3, removed: 0, added: 1 },
        survivors: 3,
        rule: 'an APPEND touches one position: three views stand, and this is the row a rebuild fails while the model still reads correct',
    },
    {
        previous: ABC,
        next: [{ value: 'z', label: 'Z' }, ...ABC],
        change: { position: 0, removed: 0, added: 1 },
        survivors: 3,
        rule: 'a PREPEND is one insertion at 0, not a shift of everything after it — positions move, nodes do not',
    },
    {
        previous: ABC,
        next: [A, C],
        change: { position: 1, removed: 1, added: 0 },
        survivors: 2,
        rule: 'a removal from the middle: the shared suffix is what keeps it one item wide',
    },
    {
        previous: ABC,
        next: [A, { value: 'b', label: 'Renamed' }, C],
        change: { position: 1, removed: 1, added: 1 },
        survivors: 2,
        rule: 'a RELABELLED item at an unchanged value is inside the range — comparing by value alone would leave the old text on screen, which is what `selection_item_changed` exists for upstream',
    },
    {
        previous: ABC,
        next: ABC,
        change: null,
        survivors: 3,
        rule: 'an equal model emits NOTHING, as GTK does — a renderer that rebuilt here would discard three live views for no change at all',
    },
    {
        previous: ABC,
        next: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C' },
        ],
        change: null,
        survivors: 3,
        rule: 'equality is STRUCTURAL, not by array identity: a caller that rebuilds its array every render must not force a rebuild here',
    },
    {
        previous: ABC,
        next: [],
        change: { position: 0, removed: 3, added: 0 },
        survivors: 0,
        rule: 'emptying the model removes everything from 0',
    },
    {
        previous: ABC,
        next: [C, B, A],
        change: { position: 0, removed: 3, added: 3 },
        survivors: 0,
        rule: 'a REVERSAL is the whole span: `items-changed` has no vocabulary for a move, and neither does `g_list_store_move`, which reports one the same way',
    },
];

/** One {@link clampListSelection} expectation. */
export interface ListSelectionClampVector {
    selected: number;
    length: number;
    result: number;
    rule: string;
}

/** Where a selection lands after the model under it was replaced. */
export const LIST_SELECTION_CLAMP_VECTORS: ReadonlyArray<ListSelectionClampVector> = [
    { selected: 1, length: 3, result: 1, rule: 'a position the new model has is kept' },
    {
        selected: 5,
        length: 3,
        result: 0,
        rule: 'a position past the end falls back to 0 — `GtkSingleSelection` autoselects rather than deselecting',
    },
    {
        selected: -1,
        length: 3,
        result: 0,
        rule: 'the SENTINEL falls back to 0 too, which is how a widget recovers a selection when its model grows; a one-sided `selected >= length` would leave the -1 standing',
    },
    {
        selected: 0,
        length: 0,
        result: -1,
        rule: 'an EMPTY model has no 0 to fall back to, so it lands on the sentinel and a placeholder becomes drawable',
    },
    {
        selected: Number.NaN,
        length: 3,
        result: 0,
        rule: 'a non-finite position addresses no item — the same answer as one past the end, so a `parseInt` of a malformed attribute cannot poison the index',
    },
];

/** One {@link tabViewItemsChanged} expectation, with the order it replays. */
export interface TabPagesItemsChangedVector {
    change: TabViewPagesChange;
    itemsChanged: AdwListItemsChanged;
    /** The page order before the change. */
    before: readonly string[];
    /** The page order after it — what {@link replayTabPagesAsSplices} must reproduce. */
    after: readonly string[];
    rule: string;
}

/**
 * `TabViewPagesChange` → the portable `items-changed`, and what replaying it does to the
 * order.
 *
 * The `before`/`after` pair is why these rows are worth having: a mapping asserted only
 * against three numbers proves the arithmetic and not the CLAIM, which is that the
 * portable signal carries everything a renderer needs to follow the collection.
 *
 * CORE-ONLY: the inputs are `TAB_VIEW_VECTORS`' own `pagesChanges`, which both renderer
 * tab-view suites drive — each replays the changes ITS real widget emitted through
 * {@link replayTabPagesAsSplices} and compares the result against the order that widget
 * ended on, so the mapping is covered on both renderers under that table's name. Rows
 * here are the hand-written edges (a move in each direction, a pin) that a fixture may or
 * may not reach, so they are asserted against the function directly rather than left to
 * whichever ops the tab-view fixtures happen to contain.
 */
export const TAB_PAGES_ITEMS_CHANGED_VECTORS: ReadonlyArray<TabPagesItemsChangedVector> = [
    {
        change: { kind: 'attached', id: 'C', position: 2, previousPosition: -1 },
        itemsChanged: { position: 2, removed: 0, added: 1 },
        before: ['A', 'B'],
        after: ['A', 'B', 'C'],
        rule: 'attached is one addition at the new position; `previousPosition` is -1 because the page had none',
    },
    {
        change: { kind: 'detached', id: 'B', position: 1, previousPosition: 1 },
        itemsChanged: { position: 1, removed: 1, added: 0 },
        before: ['A', 'B', 'C'],
        after: ['A', 'C'],
        rule: 'detached is one removal at the position it was removed FROM',
    },
    {
        change: { kind: 'updated', id: 'B', position: 1, previousPosition: 1 },
        itemsChanged: { position: 1, removed: 1, added: 1 },
        before: ['A', 'B', 'C'],
        after: ['A', 'B', 'C'],
        rule: 'a per-page notify is removed-1/added-1 at that position — `GListModel` has no other verb for "this item is different now" — and it moves nothing',
    },
    {
        change: { kind: 'reordered', id: 'D', position: 1, previousPosition: 3 },
        itemsChanged: { position: 1, removed: 3, added: 3 },
        before: ['A', 'B', 'C', 'D'],
        after: ['A', 'D', 'B', 'C'],
        rule: 'a move BACKWARDS is the span between the two positions, re-added in the new order',
    },
    {
        change: { kind: 'reordered', id: 'A', position: 2, previousPosition: 0 },
        itemsChanged: { position: 0, removed: 3, added: 3 },
        before: ['A', 'B', 'C', 'D'],
        after: ['B', 'C', 'A', 'D'],
        rule: 'a move FORWARDS spans the same way — the position is the LOWER of the two, so the range covers both ends',
    },
    {
        change: { kind: 'pinned', id: 'C', position: 0, previousPosition: 2 },
        itemsChanged: { position: 0, removed: 3, added: 3 },
        before: ['A', 'B', 'C'],
        after: ['C', 'A', 'B'],
        rule: 'pinning is a flip AND a re-order, so it reports as the move it is rather than as an update in place',
    },
];

/**
 * Replay page changes as splices over an order — the reconstruction that makes the
 * portable signal's sufficiency measurable.
 *
 * It uses nothing but {@link tabViewItemsChanged}'s three numbers and the change's `id`,
 * which is exactly what a GTK consumer has: `items-changed` gives the RANGE and the
 * consumer re-reads the model over it. Both renderer tab-view suites feed it the changes
 * their real widget emitted and compare against the order that widget ended on, so a
 * mapping that quietly loses a page fails there and not only here.
 */
export function replayTabPagesAsSplices(order: readonly string[], changes: readonly TabViewPagesChange[]): string[] {
    const result = [...order];
    for (const change of changes) {
        const { position, removed, added } = tabViewItemsChanged(change);
        const span = result.splice(position, removed);
        if (added === 0) continue;
        if (change.kind === 'attached') {
            result.splice(position, 0, change.id);
            continue;
        }
        if (change.kind === 'updated') {
            result.splice(position, 0, ...span);
            continue;
        }
        // A move: the same items, with the one that moved put where the change says it is.
        const rest = span.filter((id) => id !== change.id);
        rest.splice(change.position - position, 0, change.id);
        result.splice(position, 0, ...rest);
    }
    return result;
}
