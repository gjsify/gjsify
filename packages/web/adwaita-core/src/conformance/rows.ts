// Row state-machine conformance vectors — the spec both renderers are held to.
//
// `ComboState` (rows.ts) is shared by FOUR widgets across the two ports: the
// browser's `<adw-combo-row>` and `<adw-drop-down>`, and NativeScript's
// `AdwComboRow` and `AdwDropDown`. Every one of them was exercised by a spec
// before this file existed, and no two of those specs asserted the same thing:
// the browser suite drove real elements through `adw-row-state.spec.ts`, the
// NativeScript suite smoke-tested the re-exported class in `index.spec.ts`, and
// the core drove the class directly in `rows.spec.ts`. Three readings of one
// state machine, agreeing by luck. This table is the reading.
//
// TWO PLACES WHERE THE PORTS DIVERGE FROM THE C, RECORDED RATHER THAN ENCODED
// SILENTLY:
//
//   1. The `interactive` flag is OURS, not GTK's. `row_activated_cb` routes the
//      popup's position through the SAME `adw_combo_row_set_selected` a
//      programmatic set uses (adw-combo-row.c:209), and every real change
//      reaches `g_object_notify_by_pspec (…, PROP_SELECTED)` (:154) — so in GTK
//      `notify::selected` fires on a programmatic set too. Both ports re-emit
//      their `notify::selected` event only for a user pick and refresh the
//      display silently otherwise; `rows.ts:21-27` states that as a deliberate
//      port rule. The vectors carry the flag so a renderer that mixes the two
//      paths up fails a test, and this note so nobody reads the flag as GTK's.
//
//   2. "Nothing is selected" has no representation. `Adw.ComboRow:selected` is
//      a `guint` whose default and empty value are `GTK_INVALID_LIST_POSITION`
//      (= G_MAXUINT, :593-596; :809-810 returns it when there is no selection
//      model at all). `ComboState` starts at index 0 and reports an empty
//      `selectedValue`/`selectedLabel` instead, because both renderers paint a
//      LABEL and `''` is what they can draw. The rows below pin `0` + `''`, and
//      say so where it applies.
//
// What the C DOES settle, and what the rows are derived from:
//   - the no-op guard: the setter returns before touching the selection when
//     the position already holds (:785-786), so no notify;
//   - the notify itself: `selection_changed` (:136-155) re-emits `selected`
//     whenever the underlying `GtkSingleSelection` moves;
//   - `selection_item_changed` (:157-185) refreshes the ITEM-derived output —
//     the accessible value text and, with `use-subtitle`, the row subtitle —
//     which is why replacing the model at an unchanged index must still repaint.
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
    /** Short scenario name. */
    name: string;
    /** The mutations, applied in order to a fresh state. */
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
    /** Why this row exists — the rule or edge case it pins down. */
    rule: string;
}

const AB: ReadonlyArray<AdwComboOption> = [
    { label: 'One', value: 'a' },
    { label: 'Two', value: 'b' },
];

/**
 * `adw_combo_row_set_selected` (adw-combo-row.c:772-789) and the notify chain it
 * drives (:136-155, :157-185), plus the two port answers the C leaves open (see
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
        selected: 0,
        value: '',
        label: '',
        emitted: [{ selected: 0, value: '', label: '', interactive: false }],
        rule: 'GTK reports GTK_INVALID_LIST_POSITION here (:593-596, :809-810); the ports report index 0 with an empty value — see the module header',
    },
    {
        name: 'picking from an empty model',
        steps: [
            { op: 'setOptions', options: [] },
            { op: 'select', index: 0 },
        ],
        selected: 0,
        value: '',
        label: '',
        emitted: [{ selected: 0, value: '', label: '', interactive: false }],
        rule: 'index 0 is already held, so there is nothing to pick — the renderers never open a chooser over an empty model either',
    },
];
