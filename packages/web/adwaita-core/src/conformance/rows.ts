// Row state-machine conformance vectors — the spec both renderers are held to.
//
// `ComboState` (rows.ts) is shared by FOUR widgets across the two ports — the browser's
// `<adw-combo-row>` and `<gtk-drop-down>`, NativeScript's `AdwComboRow` and `GtkDropDown`
// — each of which had its own spec asserting its own reading. This table is the reading.
//
// TWO DELIBERATE DIVERGENCES FROM THE C, recorded rather than encoded silently:
//
//   1. The `interactive` flag is OURS, not GTK's. `row_activated_cb` routes the popup's
//      position through the SAME `adw_combo_row_set_selected` a programmatic set uses, so
//      in GTK `notify::selected` fires on a programmatic set too. Both ports re-emit only
//      for a user pick and refresh the display silently otherwise; `rows.ts` states that
//      as the port rule. The flag is here so a renderer that mixes the two paths up fails
//      a test — do not read it as GTK's.
//
//      THE CARVE-OUT IS A DOM-RENDERER RULE, AND NO LONGER A UNIVERSAL ONE. A surface that
//      owns real GObject properties has no such choice: a declared `selected` notifies
//      whatever moved it, so NativeScript's `AdwComboRow` matches the C and reads the
//      `notified` column rather than `emitted`'s `interactive` gate. The flag still holds
//      for every renderer whose "selection" is a DOM attribute, which is both browser
//      elements and every port surface that has not been declared yet.
//
//   2. "Nothing is selected" is `ADW_COMBO_NO_SELECTION` (-1), the TS spelling of
//      `GTK_INVALID_LIST_POSITION` (= G_MAXUINT), matching `ADW_SIDEBAR_NO_SELECTION`.
//      The SIGN is the divergence and all of it: the position is otherwise GTK's, and an
//      index the model does not have is refused on both sides (see below).
//
// `<adw-combo-row>` DRIVES this table too, and the day it started is the day its model
// became input a consumer can replace: two of the four step ops had no DOM spelling there
// while its options arrived through the `items` attribute at connect time only (`items`
// was not in `observedAttributes`) and it published no select-by-value setter. It now
// publishes `options`/`items` and `selectedValue`, and inherits these rows, as this
// paragraph said it would.
//
// THE `an index past the end` ROW USED TO BE WHERE THE TWO BROWSER RENDERERS PARTED, and
// it no longer is. `refs/gtk` is empty, so what `gtk_single_selection_set_selected` does
// with an out-of-range position was not readable in this tree and each renderer stated its
// own answer — `<adw-combo-row>` kept it, `<gtk-drop-down>` rejected it. ADR 0122 measured
// it instead (`combo-probe2.js`, GJS 1.88.01 / GTK 4.22.5 / libadwaita 1.9.4): BOTH widgets
// ignore the write, silently, emitting nothing, and `GTK_INVALID_LIST_POSITION` on a
// non-empty model is ignored the same way. `ComboState.setSelectedIndex` is now that
// answer, the per-renderer carve-out is gone, and this row is shared like the rest.
//
// THE `notified` COLUMN is the `notify::` ORDER of ADR 0122 § 5 — measured, not derived,
// and not the same on every path (a `model` write ends with `model` and notifies all three
// even when nothing moved; an `items-changed` puts `selected-item` BEFORE `selected`,
// the inverse of a `selected` write). A renderer that owns real GObject properties re-emits
// it verbatim; a DOM renderer has no such properties and drives `emitted` only.
//
// What the C DOES settle, and what the rows are derived from:
//   - the no-op guard: the setter returns before touching the selection when the position
//     already holds, so no notify;
//   - the notify: `selection_changed` re-emits `selected` whenever the underlying
//     `GtkSingleSelection` moves;
//   - `selection_item_changed` refreshes the ITEM-derived output — the accessible value
//     text and, with `use-subtitle`, the row subtitle — which is why replacing the model
//     at an unchanged index must still repaint.
//
// Reference: refs/libadwaita/src/adw-combo-row.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwComboOption, ComboNotify, ComboStateChange } from '../rows.js';

/**
 * One mutation in a combo scenario. DATA, not a closure: a renderer suite
 * replays these against a real widget (set the options, pick from the chooser)
 * and compares what the user would see.
 *
 * `setModel` carries the model's CONTENTS and not a model object, so the table stays
 * portable: each renderer builds whatever model it holds — a `GjsifyOptionList` in the
 * core and in both browser elements, the same on the NativeScript host — out of these
 * descriptors. `setModelAgain` is the one step that is about the model's IDENTITY rather
 * than its contents, and it is a step rather than a flag because that is the only way to
 * spell "assign the object you are already holding" in data.
 */
export type ComboSelectionStep =
    | { op: 'setModel'; model: ReadonlyArray<AdwComboOption> }
    | { op: 'setModelAgain' }
    | { op: 'setSelectedIndex'; index: number }
    | { op: 'setSelectedValue'; value: string }
    | { op: 'select'; index: number };

/** One combo-selection scenario. */
export interface ComboSelectionVector {
    name: string;
    steps: readonly ComboSelectionStep[];
    /** `selectedIndex` afterwards. */
    selected: number;
    /** `selectedValue` afterwards — `''` when nothing is selected. */
    value: string;
    /** `selectedLabel` afterwards — the text the inline value / button shows. */
    label: string;
    /**
     * Every change the state emits, in order. This IS the renderer's feed: the
     * label repaint comes off `label`, and the `notify::selected` re-emit is
     * gated on `interactive`.
     */
    emitted: ReadonlyArray<ComboStateChange>;
    /**
     * Every `notify::` the scenario owes, flattened in EMISSION ORDER — see the module
     * header. Driven by the surfaces that have real GObject properties; a DOM renderer
     * skips it.
     */
    notified: ReadonlyArray<ComboNotify>;
    rule: string;
}

const AB: ReadonlyArray<AdwComboOption> = [
    { label: 'One', value: 'a' },
    { label: 'Two', value: 'b' },
];

/** The `notify::` a non-null `model` write owes — all three, measured, in this order. */
const MODEL_NOTIFY: ReadonlyArray<ComboNotify> = ['selected', 'selected-item', 'model'];

/** The `notify::` a `selected` write that MOVED owes. The inverse order of a splice. */
const SELECTED_NOTIFY: ReadonlyArray<ComboNotify> = ['selected', 'selected-item'];

/**
 * `adw_combo_row_set_selected` and the notify chain it
 * drives, plus the two port answers the C leaves open (see
 * the module header).
 *
 * Note that EVERY scenario starts with a `setModel`, which is itself an
 * emission: the model is what the label is read out of, so a renderer that
 * repaints only on a selection change draws a stale value after the list is
 * replaced. That first change is in `emitted` for exactly that reason.
 */
export const COMBO_SELECTION_VECTORS: ReadonlyArray<ComboSelectionVector> = [
    {
        name: 'programmatic index set',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setSelectedIndex', index: 1 },
        ],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY],
        rule: 'a changed position reaches the selection, whose notify becomes `notify::selected` (:788 → :154)',
    },
    {
        name: 'setting the index already held',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setSelectedIndex', index: 1 },
            { op: 'setSelectedIndex', index: 1 },
        ],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY],
        rule: 'the setter returns before touching the selection when the position holds (:785-786) — no notify',
    },
    {
        name: 'the chooser pick',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'select', index: 1 },
        ],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: true },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY],
        rule: 'the popup routes its position through the SAME setter (:209); only the `interactive` tag differs, and that tag is ours',
    },
    {
        name: 'picking the option already selected',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'select', index: 0 },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [{ selected: 0, value: 'a', label: 'One', interactive: false }],
        notified: MODEL_NOTIFY,
        rule: 'the same-position guard (:785-786) applies to the user path too — reopening and re-picking notifies nothing',
    },
    {
        name: 'a dismissed chooser',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'select', index: -1 },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [{ selected: 0, value: 'a', label: 'One', interactive: false }],
        notified: MODEL_NOTIFY,
        rule: "no C equivalent: a dismissed native sheet resolves to the cancel label, so the renderer looks up -1 — the guard is the substitution's",
    },
    {
        name: 'select by value',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setSelectedValue', value: 'b' },
        ],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY],
        rule: 'a value maps to the FIRST option carrying it; the port addition over the C, whose model is positional',
    },
    {
        name: 'select by an unknown value',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setSelectedValue', value: 'zzz' },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [{ selected: 0, value: 'a', label: 'One', interactive: false }],
        notified: MODEL_NOTIFY,
        rule: 'an unknown value is a no-op, never a reset to 0 — a mistyped binding must not silently move the selection',
    },
    {
        name: 'the model is replaced at the same index',
        steps: [
            { op: 'setModel', model: [{ label: 'First', value: 'a' }] },
            { op: 'setModel', model: [{ label: 'Renamed', value: 'a' }] },
        ],
        selected: 0,
        value: 'a',
        label: 'Renamed',
        emitted: [
            { selected: 0, value: 'a', label: 'First', interactive: false },
            { selected: 0, value: 'a', label: 'Renamed', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...MODEL_NOTIFY],
        rule: 'the index did not move but the ITEM did — `selection_item_changed` (:157-185) repaints off the item, not the position',
    },
    {
        name: 'the model shrinks past the selection',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setSelectedIndex', index: 1 },
            { op: 'setModel', model: [{ label: 'Only', value: 'a' }] },
        ],
        selected: 0,
        value: 'a',
        label: 'Only',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
            { selected: 0, value: 'a', label: 'Only', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY, ...MODEL_NOTIFY],
        rule: 'a selection the new model does not have cannot survive — and the row below says it would not have survived even if it did',
    },
    {
        name: 'a new model with an equal shape',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setSelectedIndex', index: 1 },
            { op: 'setModel', model: AB },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
            { selected: 0, value: 'a', label: 'One', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY, ...MODEL_NOTIFY],
        rule: 'a model write RESETS the selection to 0, it does not clamp it: index 1 exists in the new model and is given up anyway (measured — GtkSingleSelection autoselects over the model it was just handed, having no memory of the one before it)',
    },
    {
        name: 'assigning the model already held',
        steps: [{ op: 'setModel', model: AB }, { op: 'setSelectedIndex', index: 1 }, { op: 'setModelAgain' }],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY],
        rule: 'the row above by identity rather than by contents — `model` holds an OBJECT now (ADR 0122 § 4), so assigning the one already held is the no-op `g_object_set` makes it, and the selection survives what an equal-but-distinct model resets',
    },
    {
        name: 'an index past the end',
        steps: [
            { op: 'setModel', model: [{ label: 'Only', value: 'a' }] },
            { op: 'setSelectedIndex', index: 5 },
        ],
        selected: 0,
        value: 'a',
        label: 'Only',
        emitted: [{ selected: 0, value: 'a', label: 'Only', interactive: false }],
        notified: MODEL_NOTIFY,
        rule: 'an index the model does not have is IGNORED — silently, with no notify and no error, on both widgets (measured; see the module header for the per-renderer answers this replaced)',
    },
    {
        name: 'an empty model',
        steps: [{ op: 'setModel', model: [] }],
        selected: -1,
        value: '',
        label: '',
        emitted: [{ selected: -1, value: '', label: '', interactive: false }],
        notified: MODEL_NOTIFY,
        rule: 'GTK_INVALID_LIST_POSITION (:593-596, :809-810) — an empty model has no index 0 to autoselect, and still notifies all three',
    },
    {
        name: 'picking from an empty model',
        steps: [
            { op: 'setModel', model: [] },
            { op: 'select', index: 0 },
        ],
        selected: -1,
        value: '',
        label: '',
        emitted: [{ selected: -1, value: '', label: '', interactive: false }],
        notified: MODEL_NOTIFY,
        rule: 'there is no option 0 to pick — and the renderers never open a chooser over an empty model either',
    },
    {
        name: 'emptying a model that had a selection',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setSelectedIndex', index: 1 },
            { op: 'setModel', model: [] },
        ],
        selected: -1,
        value: '',
        label: '',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
            { selected: -1, value: '', label: '', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...SELECTED_NOTIFY, ...MODEL_NOTIFY],
        rule: 'the selection does NOT survive as index 0 — there is nothing at 0 any more. An EMPTY model still notifies all three, because the write is what notifies and not the outcome; only `model = null` notifies `model` alone',
    },
    {
        name: 'a model that is emptied and refilled',
        steps: [
            { op: 'setModel', model: AB },
            { op: 'setModel', model: [] },
            { op: 'setModel', model: AB },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: -1, value: '', label: '', interactive: false },
            { selected: 0, value: 'a', label: 'One', interactive: false },
        ],
        notified: [...MODEL_NOTIFY, ...MODEL_NOTIFY, ...MODEL_NOTIFY],
        rule: 'autoselect runs again, so the sentinel recovers to 0 — it is BELOW the range, which a one-sided >= length check leaves in place',
    },
    {
        name: 'a model with an empty first label is still a selection',
        steps: [{ op: 'setModel', model: [{ label: '', value: 'blank' }] }],
        selected: 0,
        value: 'blank',
        label: '',
        emitted: [{ selected: 0, value: 'blank', label: '', interactive: false }],
        notified: MODEL_NOTIFY,
        rule: 'the case the sentinel exists to separate: an empty LABEL, not an empty model',
    },
];

// --- Gio.ListModel::items-changed → the selection -----------

/** One splice applied to the model a combo state is HOLDING. */
export interface ComboSpliceStep {
    position: number;
    removed: number;
    added: ReadonlyArray<AdwComboOption>;
}

/** One `items-changed` → selection scenario. */
export interface ComboItemsChangedVector {
    name: string;
    /** The model the state holds before the splice. */
    initial: ReadonlyArray<AdwComboOption>;
    /** Where the selection sits before the splice — `-1` leaves the sentinel in place. */
    selected: number;
    splice: ComboSpliceStep;
    /** `selectedIndex` after the splice. */
    result: number;
    /** `selectedValue` after the splice. */
    value: string;
    /** The `notify::` the splice owes, in order — EMPTY where GTK emits none. */
    notified: ReadonlyArray<ComboNotify>;
    rule: string;
}

const ABC: ReadonlyArray<AdwComboOption> = [
    { label: 'One', value: 'a' },
    { label: 'Two', value: 'b' },
    { label: 'Three', value: 'c' },
];

/**
 * What a splice on the HELD model does to the selection — `GtkSingleSelection`'s
 * `items-changed` handler, which `Adw.ComboRow` and `Gtk.DropDown` both sit on.
 *
 * NEW IN ADR 0122, and only reachable since it: while `model` was an Array the only way to
 * change the list was to replace it, so this whole axis had no spelling. A live
 * `Gio.ListModel` moves under the widget, and WHERE it moved decides whether the selection
 * follows the item, shifts with it, or is clamped because the item is gone.
 *
 * Every row is MEASURED (`combo-probe2.js`), and the `notified` column is the point of the
 * table: the order here is the INVERSE of a `selected` write — `selected-item` first,
 * because what changed is the item and the index is downstream of it. The shift row
 * notifies `selected` ALONE for the mirror-image reason (the item did not change, only its
 * position), and the replace-in-place row notifies `selected-item` alone.
 *
 * `<adw-combo-row>` drives the table through its own DOM, which is where the splice has to
 * land for a user to see it: the outcome columns, the rebuilt `<option>` list, and the
 * SILENCE a DOM surface owes (a model moving underneath is not a user pick, so no
 * `notify::selected` event). The `notified` column itself stays with the core suite — it is
 * a GObject property feed, and no port publishes one for this path yet; `subscribeNotify`
 * is the seam a host that owns real properties will re-emit from.
 */
export const COMBO_ITEMS_CHANGED_VECTORS: ReadonlyArray<ComboItemsChangedVector> = [
    {
        name: 'a change entirely after the selection',
        initial: ABC,
        selected: 0,
        splice: { position: 2, removed: 1, added: [{ label: 'Gamma', value: 'g' }] },
        result: 0,
        value: 'a',
        notified: [],
        rule: 'the selected item neither moved nor changed — GTK emits nothing, and a widget that re-emitted here would re-run every binding on every append',
    },
    {
        name: 'a change entirely before the selection',
        initial: ABC,
        selected: 2,
        splice: { position: 0, removed: 0, added: [{ label: 'Zero', value: 'z' }] },
        result: 3,
        value: 'c',
        notified: ['selected'],
        rule: 'the index shifts by `added - removed` so it keeps addressing the SAME item — `selected-item` is therefore silent, which is what distinguishes this from every other row',
    },
    {
        name: 'the selected item is replaced in place',
        initial: ABC,
        selected: 1,
        splice: { position: 1, removed: 1, added: [{ label: 'Beta', value: 'beta' }] },
        result: 1,
        value: 'beta',
        notified: ['selected-item'],
        rule: 'the mirror image: the position held and the item did not, so `selected-item` notifies alone — a widget keyed on `notify::selected` alone draws the old label here',
    },
    {
        name: 'the selected item is removed',
        initial: ABC,
        selected: 2,
        splice: { position: 2, removed: 1, added: [] },
        result: 1,
        value: 'b',
        notified: ['selected-item', 'selected'],
        rule: 'the selection clamps to `min(position, n_items - 1)`, and BOTH notify — `selected-item` first',
    },
    {
        name: 'every item is removed',
        initial: ABC,
        selected: 0,
        splice: { position: 0, removed: 3, added: [] },
        result: -1,
        value: '',
        notified: ['selected-item', 'selected'],
        rule: 'an emptied model has no position to clamp onto, so the clamp lands on the sentinel — same two notifies, same order',
    },
    {
        name: 'the first item arrives in an empty model',
        initial: [],
        selected: -1,
        splice: { position: 0, removed: 0, added: [{ label: 'One', value: 'a' }] },
        result: 0,
        value: 'a',
        notified: ['selected-item', 'selected'],
        rule: 'autoselect takes 0 the moment there is a 0 — the sentinel is a state a growing model recovers from, not one it stays in',
    },
];

// --- The chooser predicate (model_changed) -----------

/** One `presentsChooser` expectation. */
export interface ComboChooserVector {
    count: number;
    /** Whether the arrow is drawn and the row is activatable. */
    presentsChooser: boolean;
    rule: string;
}

/**
 * `model_changed` — one predicate, `n_items > 1`,
 * driving BOTH `gtk_widget_set_visible (arrow_box, …)` and
 * `gtk_list_box_row_set_activatable (row, …)`.
 *
 * A row with one option or none has nothing to choose, so it stops presenting itself as a
 * chooser: no chevron, and no sheet with a single entry in it.
 *
 * `Gtk.DropDown` is deliberately NOT covered — it keeps its arrow at any count,
 * which is why this lives on the combo ROW rather than in the shared chooser.
 */
export const COMBO_CHOOSER_VECTORS: ReadonlyArray<ComboChooserVector> = [
    { count: 0, presentsChooser: false, rule: 'an empty model is not a chooser' },
    { count: 1, presentsChooser: false, rule: 'ONE option is not a choice — the arrow goes and the row goes inert' },
    { count: 2, presentsChooser: true, rule: 'two is the smallest real choice — the predicate is > 1, not >= 1' },
    { count: 5, presentsChooser: true, rule: 'and anything above it' },
];

// --- Adw.ToggleGroup:active-name --------------------

/** One authored `active-name`, over toggles carrying these names. */
export interface ToggleActiveNameVector {
    /** Each authored toggle's `name`, in document order; `null` is unnamed. */
    names: readonly (string | null)[];
    /** The authored `Adw.ToggleGroup:active-name`. */
    activeName: string;
    /** How many toggles the group keeps — `keptToggles`, the buttons a built group draws. */
    kept: number;
    /** What `toggleIndexOfName` answers over the kept names — `-1` for none. */
    index: number;
    /** The button a BUILT group shows active afterwards. */
    active: number;
    rule: string;
}

/**
 * `adw_toggle_group_set_active_name` (adw-toggle-group.c:1989) resolves the name through
 * the table `add_toggle` fills (:898), and a `.blp` writes it BEFORE the toggles exist —
 * GtkBuilder sets properties first and children after, which is why the C holds the name
 * back in `delayed_active_name` until `parser_finished` (:1247). `active` is therefore a
 * row about the built tree, not about the lookup: a renderer that resolves the name the
 * moment it is written finds no toggles and drops it.
 *
 * The first toggle is active before the name is applied, because `add_toggle` activates
 * the first toggle it is given (:903). Every row was measured against libadwaita 1.9.3
 * through `Gtk.Builder`, and the shared-name row is the one the source reading got wrong
 * first: the table insert at :898 looks like "last one wins", but :849 refuses the second
 * toggle before it is ever reached.
 */
export const TOGGLE_ACTIVE_NAME_VECTORS: ReadonlyArray<ToggleActiveNameVector> = [
    {
        names: ['list', 'grid', 'columns'],
        activeName: 'grid',
        kept: 3,
        index: 1,
        active: 1,
        rule: 'selects the toggle carrying the name',
    },
    {
        names: ['list', 'grid', 'columns'],
        activeName: 'columns',
        kept: 3,
        index: 2,
        active: 2,
        rule: 'the last toggle is reachable — the name is applied after every toggle is in',
    },
    {
        names: ['list', 'grid', 'list'],
        activeName: 'list',
        kept: 2,
        index: 0,
        active: 0,
        rule: 'a name already taken is refused WITH its toggle — the group keeps two, and the name means the first',
    },
    {
        names: [null, 'grid'],
        activeName: 'grid',
        kept: 2,
        index: 1,
        active: 1,
        rule: 'an unnamed toggle is kept and takes no part in the lookup',
    },
    {
        names: ['list', 'grid'],
        activeName: 'missing',
        kept: 2,
        index: -1,
        active: 0,
        rule: 'a name no toggle carries changes nothing — the first toggle, which add made active, stays',
    },
];
