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
//   2. "Nothing is selected" is `ADW_COMBO_NO_SELECTION` (-1), the TS spelling of
//      `GTK_INVALID_LIST_POSITION` (= G_MAXUINT), matching `ADW_SIDEBAR_NO_SELECTION`.
//      Still ours: an index PAST the end is accepted rather than folded onto the
//      sentinel — `setSelectedIndex` mirrors a guint property that takes any position,
//      and `ComboState.hasIndex` is where each renderer states its own policy.
//
// `<adw-combo-row>` DRIVES this table too, and the day it started is the day its model
// became input a consumer can replace: two of the four step ops had no DOM spelling there
// while its options arrived through the `items` attribute at connect time only (`items`
// was not in `observedAttributes`) and it published no select-by-value setter. It now
// publishes `options`/`items` and `selectedValue`, and inherits these rows, as this
// paragraph said it would.
//
// The `an index past the end` row is where the two browser renderers part, which is the
// reason it is worth having both of them on the table. `<gtk-drop-down>` is driven against
// its OWN answer — the element REJECTS an out-of-range set, as its published `selected`
// docs promise — while `<adw-combo-row>` runs the row as written, keeping the permissive
// answer `setSelectedIndex` gives. The bounds predicate is shared, the policy is each
// renderer's, and neither side can now change in silence.
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

import type { AdwComboOption, ComboStateChange } from '../rows.js';

/**
 * One mutation in a combo scenario. DATA, not a closure: a renderer suite
 * replays these against a real widget (set the options, pick from the chooser)
 * and compares what the user would see.
 */
export type ComboSelectionStep =
    | { op: 'setOptions'; options: ReadonlyArray<AdwComboOption> }
    | { op: 'setSelectedIndex'; index: number }
    | { op: 'setSelectedValue'; value: string }
    | { op: 'select'; index: number };

/** One combo-selection scenario. */
export interface ComboSelectionVector {
    name: string;
    steps: readonly ComboSelectionStep[];
    /** `selectedIndex` afterwards. */
    selected: number;
    /** `selectedValue` afterwards — `''` when the index sits outside the options. */
    value: string;
    /** `selectedLabel` afterwards — the text the inline value / button shows. */
    label: string;
    /**
     * Every change the state emits, in order. This IS the renderer's feed: the
     * label repaint comes off `label`, and the `notify::selected` re-emit is
     * gated on `interactive`.
     */
    emitted: ReadonlyArray<ComboStateChange>;
    rule: string;
}

const AB: ReadonlyArray<AdwComboOption> = [
    { label: 'One', value: 'a' },
    { label: 'Two', value: 'b' },
];

/**
 * `adw_combo_row_set_selected` and the notify chain it
 * drives, plus the two port answers the C leaves open (see
 * the module header).
 *
 * Note that EVERY scenario starts with a `setOptions`, which is itself an
 * emission: the model is what the label is read out of, so a renderer that
 * repaints only on a selection change draws a stale value after the list is
 * replaced. That first change is in `emitted` for exactly that reason.
 */
export const COMBO_SELECTION_VECTORS: ReadonlyArray<ComboSelectionVector> = [
    {
        name: 'programmatic index set',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'setSelectedIndex', index: 1 },
        ],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
        ],
        rule: 'a changed position reaches the selection, whose notify becomes `notify::selected` (:788 → :154)',
    },
    {
        name: 'setting the index already held',
        steps: [
            { op: 'setOptions', options: AB },
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
        rule: 'the setter returns before touching the selection when the position holds (:785-786) — no notify',
    },
    {
        name: 'the chooser pick',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'select', index: 1 },
        ],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: true },
        ],
        rule: 'the popup routes its position through the SAME setter (:209); only the `interactive` tag differs, and that tag is ours',
    },
    {
        name: 'picking the option already selected',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'select', index: 0 },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [{ selected: 0, value: 'a', label: 'One', interactive: false }],
        rule: 'the same-position guard (:785-786) applies to the user path too — reopening and re-picking notifies nothing',
    },
    {
        name: 'a dismissed chooser',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'select', index: -1 },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [{ selected: 0, value: 'a', label: 'One', interactive: false }],
        rule: "no C equivalent: a dismissed native sheet resolves to the cancel label, so the renderer looks up -1 — the guard is the substitution's",
    },
    {
        name: 'select by value',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'setSelectedValue', value: 'b' },
        ],
        selected: 1,
        value: 'b',
        label: 'Two',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
        ],
        rule: 'a value maps to the FIRST option carrying it; the port addition over the C, whose model is positional',
    },
    {
        name: 'select by an unknown value',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'setSelectedValue', value: 'zzz' },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [{ selected: 0, value: 'a', label: 'One', interactive: false }],
        rule: 'an unknown value is a no-op, never a reset to 0 — a mistyped binding must not silently move the selection',
    },
    {
        name: 'the model is replaced at the same index',
        steps: [
            { op: 'setOptions', options: [{ label: 'First', value: 'a' }] },
            { op: 'setOptions', options: [{ label: 'Renamed', value: 'a' }] },
        ],
        selected: 0,
        value: 'a',
        label: 'Renamed',
        emitted: [
            { selected: 0, value: 'a', label: 'First', interactive: false },
            { selected: 0, value: 'a', label: 'Renamed', interactive: false },
        ],
        rule: 'the index did not move but the ITEM did — `selection_item_changed` (:157-185) repaints off the item, not the position',
    },
    {
        name: 'the model shrinks past the selection',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'setSelectedIndex', index: 1 },
            { op: 'setOptions', options: [{ label: 'Only', value: 'a' }] },
        ],
        selected: 0,
        value: 'a',
        label: 'Only',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
            { selected: 0, value: 'a', label: 'Only', interactive: false },
        ],
        rule: "a selection past the end of the new model falls back to 0 — GtkSingleSelection autoselects upstream, whose C is not vendored here, so this row is the ports' shared answer",
    },
    {
        name: 'an index past the end',
        steps: [
            { op: 'setOptions', options: [{ label: 'Only', value: 'a' }] },
            { op: 'setSelectedIndex', index: 5 },
        ],
        selected: 5,
        value: '',
        label: '',
        emitted: [
            { selected: 0, value: 'a', label: 'Only', interactive: false },
            { selected: 5, value: '', label: '', interactive: false },
        ],
        rule: 'the index is NOT clamped (the C takes any guint); the empty value/label is how "nothing to draw" is expressed here',
    },
    {
        name: 'an empty model',
        steps: [{ op: 'setOptions', options: [] }],
        selected: -1,
        value: '',
        label: '',
        emitted: [{ selected: -1, value: '', label: '', interactive: false }],
        rule: 'GTK_INVALID_LIST_POSITION (:593-596, :809-810) — an empty model has no index 0 to autoselect',
    },
    {
        name: 'picking from an empty model',
        steps: [
            { op: 'setOptions', options: [] },
            { op: 'select', index: 0 },
        ],
        selected: -1,
        value: '',
        label: '',
        emitted: [{ selected: -1, value: '', label: '', interactive: false }],
        rule: 'there is no option 0 to pick — and the renderers never open a chooser over an empty model either',
    },
    {
        name: 'emptying a model that had a selection',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'setSelectedIndex', index: 1 },
            { op: 'setOptions', options: [] },
        ],
        selected: -1,
        value: '',
        label: '',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: 1, value: 'b', label: 'Two', interactive: false },
            { selected: -1, value: '', label: '', interactive: false },
        ],
        rule: 'the selection does NOT survive as index 0 — there is nothing at 0 any more',
    },
    {
        name: 'a model that is emptied and refilled',
        steps: [
            { op: 'setOptions', options: AB },
            { op: 'setOptions', options: [] },
            { op: 'setOptions', options: AB },
        ],
        selected: 0,
        value: 'a',
        label: 'One',
        emitted: [
            { selected: 0, value: 'a', label: 'One', interactive: false },
            { selected: -1, value: '', label: '', interactive: false },
            { selected: 0, value: 'a', label: 'One', interactive: false },
        ],
        rule: 'autoselect runs again, so the sentinel recovers to 0 — it is BELOW the range, which a one-sided >= length check leaves in place',
    },
    {
        name: 'a model with an empty first label is still a selection',
        steps: [{ op: 'setOptions', options: [{ label: '', value: 'blank' }] }],
        selected: 0,
        value: 'blank',
        label: '',
        emitted: [{ selected: 0, value: 'blank', label: '', interactive: false }],
        rule: 'the case the sentinel exists to separate: an empty LABEL, not an empty model',
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
