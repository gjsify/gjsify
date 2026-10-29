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
//   OWNERSHIP       which arrays a caller keeps and which door actually moves the list,
//                   now that `model` holds a real `Gio.ListModel` (ADR 0122 § 4) and there
//                   is no array to assign back.
//
// A SIXTH TABLE WAS REMOVED HERE, and the reason belongs on the record: `CLAMP` pinned
// `clampListSelection`, where a selection landed after the model under it was REPLACED —
// clamped to the end, with the sentinel falling to 0. ADR 0122 § 4 measured libadwaita and
// a replacement does not clamp: it RESETS to 0, giving up index 1 even when the new model
// has it. The clamp survives only for a splice on the model the widget already holds,
// which is `COMBO_ITEMS_CHANGED_VECTORS` in `conformance/rows.ts` — against the real
// `GtkSingleSelection` branches and their notify order, which a pure `(selected, length)`
// function had no way to express.
//   TAB PAGES       the mapping from `TabViewPagesChange`, the one positional collection
//                   signal this package already had, onto the portable one. Each row
//                   carries the order BEFORE and AFTER, so "the three numbers plus the id
//                   are enough to replay the collection" is data rather than a claim.
//
// Copyright (c) GNOME contributors (GLib/GTK). LGPLv2.1+.

import type {
    AdwComboOption,
    AdwListItemsChanged,
    AdwListModel,
    AdwListModelInput,
    AdwListModelSource,
} from '../list.js';
import { GjsifyOptionList } from '../option-list.js';
import { tabViewItemsChanged } from '../tab-view.js';
import type { TabViewPagesChange } from '../tab-view.js';

/** A `Gtk.StringObject`-shaped item: the one item shape the normaliser unwraps. */
function stringItem(value: string): { string: string } {
    return { string: value };
}

/** A `Gio.ListModel` over the items given, by the two methods the normaliser calls. */
function listSource(...items: readonly unknown[]): AdwListModelSource {
    return {
        get_n_items: () => items.length,
        get_item: (position) => items[position] ?? null,
    };
}

/** One {@link normalizeComboOptions} expectation. */
export interface ListNormalizeVector {
    input: AdwListModelInput;
    model: AdwListModel;
    rule: string;
}

/**
 * Authored input → the normalised model.
 *
 * The browser suite drives `LIST_NORMALIZE_VECTORS` through the real `model` property of
 * `<adw-combo-row>` and of `<gtk-drop-down>`, every row of it, and core drives the
 * function.
 *
 * The NativeScript widgets take the same input and NOTHING there asserts it. That
 * package's specs reach `ComboState` and never the widget class, for the reason
 * `drop-down.spec.ts`' own header gives, and the gap is filed in `status/open-todos/README.md`
 * under "The NativeScript list-model setter is held by core's vectors, not by a widget
 * test". This docblock used to say "every surface that takes a `model` … must answer
 * these rows: … the NativeScript widgets through theirs", which reads as coverage for a
 * surface that answers none of them — the shape #1072 was about, one file further in
 * than any arm of `check-adwaita-conformance-drivers.mjs` looks (its claim arms begin at
 * a citation, and that sentence named no table).
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
    // --- a REAL list model as input (ADR 0122) -----------------------------------------------
    //
    // `Gtk.StringList` stopped being an `Array` subclass, so a model no longer satisfies the
    // array arm by accident: it is read by position. These four build a source by hand rather
    // than importing the class, because what the normaliser requires of its input is exactly
    // `get_n_items` + `get_item` and nothing about who implements them.
    {
        input: listSource(stringItem('Cyan'), stringItem('Magenta')),
        model: [
            { value: 'Cyan', label: 'Cyan' },
            { value: 'Magenta', label: 'Magenta' },
        ],
        rule: 'a model of `Gtk.StringObject`s reads as its strings — the same model an array of those strings makes',
    },
    {
        input: listSource(),
        model: [],
        rule: 'an EMPTY model is the empty model, not a model the normaliser declines to read',
    },
    {
        input: listSource({ value: 'a', label: 'One' }),
        model: [{ value: 'a', label: 'One' }],
        rule: 'an item that is no string object meets the descriptor rule, the one an array entry meets',
    },
    {
        input: listSource({}),
        model: [{ value: '', label: '' }],
        rule: 'an item with neither half is the empty descriptor `{}` already is — drawing it would need `expression`, which ADR 0122 leaves out',
    },
];

/**
 * A {@link LIST_NORMALIZE_VECTORS} row as the value a `model` PROPERTY write takes.
 *
 * ADR 0122 § 4 took the array arm off that property, so the ARRAY rows go in as a list built
 * out of the array: the normaliser still runs on them, one step further in, as
 * {@link GjsifyOptionList}'s own constructor. The model-source rows go STRAIGHT through —
 * that is the shape the door now takes, and they are what proves a surface reads items by
 * position rather than recognising one class.
 *
 * Lives here rather than in each driving suite because WHICH door a row reaches through is
 * part of what the table claims, and two copies of that answer are two claims.
 */
export function listModelForInput(input: AdwListModelInput): AdwListModelSource {
    return Array.isArray(input) ? GjsifyOptionList.new(input) : (input as AdwListModelSource);
}

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
 *
 * The browser suite drives `LIST_PARSE_VECTORS` through the live `model` attribute of
 * `<adw-combo-row>` and of `<gtk-drop-down>`. Two elements for one parser because the
 * parser is not what breaks: the row's `attributeChangedCallback` branch is, and it was
 * missing for that element's whole life (#1525).
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

/** What a caller does to the options they hold, or to the model they were handed. */
export type ListReadbackOp = 'append' | 'relabel-first' | 'remove-first';

/** One ownership expectation — see {@link LIST_MODEL_OWNERSHIP_VECTORS}. */
export interface ListModelOwnershipVector {
    initial: AdwListModel;
    /**
     * WHAT the caller mutates. `input` is the array they authored and handed to
     * `GjsifyOptionList.new`; `options` is the array read back out of `toOptions()`; `model`
     * is the list itself, through its own `Gio.ListModel` API. The first two must move
     * nothing and the third must move everything, and which of the three a surface gets
     * wrong is the difference between a leak and a dropped redraw.
     */
    source: 'options' | 'input' | 'model';
    op: ListReadbackOp;
    /** The options the surface holds when the row is done. */
    model: AdwListModel;
    /** The splice the surface emits, or `null` where it emits none. */
    itemsChanged: AdwListItemsChanged | null;
    /** Item views carried over untouched — `initial.length` when nothing happened. */
    survivors: number;
    rule: string;
}

/**
 * WHO OWNS THE OPTIONS — the arrays a caller holds on either side of the model, and the
 * model itself.
 *
 * The browser suite drives `LIST_MODEL_OWNERSHIP_VECTORS` through `<adw-combo-row>` and
 * `<gtk-drop-down>`, and core drives it through `ComboState`.
 *
 * READ, MUTATE, ASSIGN IS GONE AS A PATTERN, and that is what reshaped these rows. ADR 0122
 * § 4 narrows `model` to a real `Gio.ListModel`, so there is no array to assign back: the
 * only way to change a model in place is its own API, and handing over a DIFFERENT list is a
 * replacement that resets the selection. What survives from the array era is the half that
 * was never about assignment — an array a caller holds is THEIRS on both sides, going in
 * (`GjsifyOptionList` copies each descriptor into an item) and coming out (`toOptions`
 * copies each item back). `relabel-first` is why the copy is per ITEM rather than per array:
 * a shared descriptor would let the text under a selection move with nothing emitted, which
 * is the failure `GjsifyOptionObject`'s read-only `label` exists to prevent.
 *
 * The `model` rows are the other side of the same invariant: the ONE door that does move the
 * list emits the one minimal splice for it, in each of the three directions a splice can go.
 */
export const LIST_MODEL_OWNERSHIP_VECTORS: ReadonlyArray<ListModelOwnershipVector> = [
    {
        initial: [A, B],
        source: 'options',
        op: 'append',
        model: [A, B],
        itemsChanged: null,
        survivors: 2,
        rule: 'the options read back out of a model are a COPY — pushing onto them moves nothing, because the list holds items and not that array',
    },
    {
        initial: [A, B],
        source: 'options',
        op: 'relabel-first',
        model: [A, B],
        itemsChanged: null,
        survivors: 2,
        rule: 'and the copy is per ITEM: relabelling a descriptor read back leaves the item it came from alone, so no text moves without an emission',
    },
    {
        initial: [A, B],
        source: 'input',
        op: 'append',
        model: [A, B],
        itemsChanged: null,
        survivors: 2,
        rule: 'the OTHER array a caller holds — the one they authored and handed over. The list read it once; pushing onto it afterwards reaches nothing',
    },
    {
        initial: [A, B],
        source: 'input',
        op: 'relabel-first',
        model: [A, B],
        itemsChanged: null,
        survivors: 2,
        rule: 'the same per-item copy on the way IN, which is the door a constructor that stored the caller descriptors would leave open',
    },
    {
        initial: [A, B],
        source: 'model',
        op: 'append',
        model: [A, B, { value: 'z', label: 'Z' }],
        itemsChanged: { position: 2, removed: 0, added: 1 },
        survivors: 2,
        rule: 'appending THROUGH the model is one insertion at the end — the only door that moves the list, and it emits the splice for it',
    },
    {
        initial: [A, B],
        source: 'model',
        op: 'relabel-first',
        model: [{ value: 'a', label: 'Renamed' }, B],
        itemsChanged: { position: 0, removed: 1, added: 1 },
        survivors: 1,
        rule: 'relabelling is a REPLACEMENT of the item, because an item is immutable: one out, one in, at the position that changed',
    },
    {
        initial: [A, B, C],
        source: 'model',
        op: 'remove-first',
        model: [B, C],
        itemsChanged: { position: 0, removed: 1, added: 0 },
        survivors: 2,
        rule: 'the shrink direction, where the two survivors are the point: a renderer that rebuilt would report none',
    },
];

/**
 * The caller-side half of an `options`/`input` row: mutate the array, IN PLACE, and hand the
 * same array back.
 *
 * In place and returning its argument is the whole point — a helper that built a new array
 * would test the pattern that never broke.
 */
export function applyListReadback(model: AdwComboOption[], op: ListReadbackOp): AdwComboOption[] {
    if (op === 'append') model.push({ value: 'z', label: 'Z' });
    else if (op === 'relabel-first') {
        const first = model[0];
        if (first) first.label = 'Renamed';
    } else model.shift();
    return model;
}

/**
 * The model-side half: the same three ops through the list's own `Gio.ListModel` API.
 *
 * `relabel-first` is a splice rather than an assignment because {@link GjsifyOptionObject}
 * is read-only — changing what an item says means putting a different item there, which is
 * also how `Gio.ListStore` would have to spell it.
 */
export function applyListMutation(model: GjsifyOptionList, op: ListReadbackOp): void {
    if (op === 'append') model.append({ value: 'z', label: 'Z' });
    else if (op === 'relabel-first') model.splice(0, 1, [{ value: 'a', label: 'Renamed' }]);
    else model.remove(0);
}

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
