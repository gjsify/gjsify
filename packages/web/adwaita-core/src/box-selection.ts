// The selection rules of the two GTK containers that hold CHILDREN rather than a model —
// `Gtk.ListBox` and `Gtk.FlowBox` (ADR 0089).
//
// WHY A MODULE OF ITS OWN, and not `list-view.ts` beside it.
//
// `list-view.ts` ports `gtk_list_base_select_item` (gtklistbase.c:374-446), the path
// `Gtk.ListView`/`GridView`/`ColumnView` take. These two widgets do NOT go through it: they
// have no model and no selection MODEL either — `GtkListBox:selection-mode` and
// `GtkFlowBox:selection-mode` are `Gtk.SelectionMode` ENUMS on the widget, all four values
// of them, `browse` included. `gtk_list_box_update_selection_full` and
// `gtk_flow_box_update_selection` are a DIFFERENT function from the list base's, and it is
// the pair of them that agree with each other: read line for line they are the same
// function with `row` spelled `child`. So the two rules are two modules, and a renderer that
// reached for the list-view one here would get a fourth behaviour that upstream does not
// have — most visibly on `browse`, which the list base has no equivalent for at all, and on
// `<Ctrl>`+click in single mode, where these two TOGGLE the row off and
// `GtkSingleSelection` refuses (gtksingleselection.c:160-173, because `autoselect` is on).
//
// WHAT IS PORTED. Four functions, each a whole C function rather than a fragment:
//
//   `listBoxSelect`       gtk_list_box_update_selection_full  (gtklistbox.c:1799-1871)
//   `listBoxSelectRow`    gtk_list_box_select_row_internal    (gtklistbox.c:1729-1749)
//   `listBoxUnselectRow`  gtk_list_box_unselect_row_internal  (gtklistbox.c:1711-1726)
//   `listBoxSelectAll` / `listBoxUnselectAll`
//                         gtk_list_box_select_all / _unselect_all (gtklistbox.c:958-996)
//
// The click path and the programmatic path are kept APART because upstream keeps them apart
// and they are not interchangeable: `listBoxSelectRow` is idempotent (it returns early when
// the row is already selected, :1735-1736) and `listBoxSelect` toggles. One function for
// both would make `select_row()` on an already-selected row clear the selection.
//
// WHAT IS NOT PORTED, and why nothing was lost. `selectable` is an INPUT rather than a
// filter, because upstream both boxes read it off the row and the element already holds the
// row (`gtk_list_box_row_set_selectable` also UNSELECTS the row, :3697-3698, which is the
// element's business and stays there). `row_is_visible` is not a field of this surface at
// all: a hidden row is not in the DOM on this renderer, so `select_all_between` visits every
// index — which is what the C's loop does once the visibility test passes for all of them.
// `set_filter_func`/`set_sort_func`/`set_header_func` are FUNCTION properties, the family
// ADR 0046 declined twice, and the three model views' refusals say so for them.
//
// Reference: refs/gtk/gtk/gtklistbox.c:1711-1871, :958-996
// Reference: refs/gtk/gtk/gtkflowbox.c:966-1131, :4766-4800
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/**
 * `Gtk.SelectionMode`, as a word.
 *
 * `browse` is the fourth value and the reason this is not `AdwListSelectionMode`: it is a
 * mode you reach by CLICKING and that then refuses `unselect_all`, so a widget modelled on
 * the list base's three models has no vocabulary for it at all.
 *
 * `single` is the ParamSpec default in both widgets (gtklistbox.c:530-533,
 * gtkflowbox.c:3708-3712).
 */
export type AdwBoxSelectionMode = 'none' | 'single' | 'browse' | 'multiple';

const BOX_SELECTION_MODES: ReadonlySet<string> = new Set(['none', 'single', 'browse', 'multiple']);

/** An unknown mode is `single`, the ParamSpec's own default. */
export function normalizeBoxSelectionMode(raw: unknown): AdwBoxSelectionMode {
    return typeof raw === 'string' && BOX_SELECTION_MODES.has(raw) ? (raw as AdwBoxSelectionMode) : 'single';
}

/** The modifiers on a click, in `gtk_list_box_update_selection_full`'s parameter names. */
export interface AdwBoxSelectStep {
    /** `<Ctrl>` — the mode's toggle branch. */
    readonly modify?: boolean;
    /** `<Shift>` — `multiple` only, and a range from the anchor. */
    readonly extend?: boolean;
}

/** What one selection step produces, plus where the next `extend` starts. */
export interface AdwBoxSelectResult {
    /** The next selection, ascending. */
    readonly selection: number[];
    /** `box->selected_row` / `priv->selected_child` — `-1` where the C leaves it NULL. */
    readonly anchor: number;
}

/** One positional selection, normalised: ascending, no duplicates, inside `[0, length)`. */
export type AdwBoxSelection = readonly number[];

/**
 * Ascending, de-duplicated, and nothing outside `[0, length)` — the same normaliser
 * `list-view.ts` uses, which is why it is restated here rather than imported: that one is
 * private to its module and a shared helper for two lines would be a third copy of the
 * rule rather than of the code.
 */
function normalize(positions: Iterable<number>, length: number): number[] {
    const kept = new Set<number>();
    for (const position of positions) {
        if (Number.isInteger(position) && position >= 0 && position < length) kept.add(position);
    }
    return [...kept].sort((a, b) => a - b);
}

/** The inclusive span between two positions, in order — `gtk_list_box_select_all_between`. */
function spanBetween(first: number, second: number, length: number): number[] {
    const min = Math.max(0, Math.min(first, second));
    const max = Math.min(length - 1, Math.max(first, second));
    const span: number[] = [];
    for (let i = min; i <= max; i++) span.push(i);
    return span;
}

/** An anchor the C would accept as `selected_row`: a live position inside the box. */
function isLiveAnchor(anchor: number, length: number): boolean {
    return Number.isInteger(anchor) && anchor >= 0 && anchor < length;
}

/**
 * A click on `position` → the selection that follows it —
 * `gtk_list_box_update_selection_full` (gtklistbox.c:1799-1871), which is also
 * `gtk_flow_box_update_selection` (gtkflowbox.c:1077-1131).
 *
 * The C, step for step:
 *
 *   · `NONE` returns before the `selectable` test, so an unselectable row and an absent
 *     selection are the same answer: nothing changes, anchor included;
 *   · `BROWSE` unselects everything and selects the row — there is no toggle, so `<Ctrl>`
 *     +click on the selected row keeps it selected;
 *   · `SINGLE` remembers whether the row WAS selected, unselects everything, then selects
 *     `modify ? !was_selected : TRUE` (:1824-1828). That is the difference from
 *     `GtkSingleSelection`, which refuses the unselect while `autoselect` is on
 *     (gtksingleselection.c:160-173): here `<Ctrl>`+click on the selected row CLEARS the
 *     selection, and the anchor follows to `-1`;
 *   · `MULTIPLE` with `extend` unselects everything and then, if there WAS an anchor,
 *     selects the whole span between it and the row — and LEAVES THE ANCHOR WHERE IT WAS
 *     (:1846-1850). Extending twice in a row therefore walks the range outward from the
 *     first click rather than from the last;
 *   · `MULTIPLE` with `modify` toggles one row and does not move the anchor;
 *   · `MULTIPLE` with neither replaces the selection with the row. The C spells that as
 *     `set_selected (row, !selected)` AFTER unselecting all (:1862-1863), which lands on
 *     TRUE; written as a plain select it is the same answer and one less step;
 *   · a position outside the box is ignored, and so is an unselectable row.
 */
export function listBoxSelect(
    selection: AdwBoxSelection,
    anchor: number,
    position: number,
    length: number,
    mode: AdwBoxSelectionMode,
    step: AdwBoxSelectStep = {},
    selectable = true,
): AdwBoxSelectResult {
    const current = normalize(selection, length);
    const unchanged = (): AdwBoxSelectResult => ({ selection: current, anchor });

    if (mode === 'none' || !selectable) return unchanged();
    if (!Number.isInteger(position) || position < 0 || position >= length) return unchanged();

    const selected = new Set(current);

    if (mode === 'browse') {
        return { selection: [position], anchor: position };
    }

    if (mode === 'single') {
        // `was_selected` is read BEFORE the unselect-all, which is the whole point: the C
        // records it first precisely because the unselect makes the question unanswerable.
        const wasSelected = selected.has(position);
        return {
            selection: step.modify === true && wasSelected ? [] : [position],
            anchor: step.modify === true && wasSelected ? -1 : position,
        };
    }

    if (step.extend === true) {
        if (!isLiveAnchor(anchor, length)) return { selection: [position], anchor: position };
        return { selection: spanBetween(anchor, position, length), anchor };
    }

    if (step.modify === true) {
        if (selected.has(position)) selected.delete(position);
        else selected.add(position);
        return { selection: normalize(selected, length), anchor };
    }

    return { selection: [position], anchor: position };
}

/**
 * `gtk_list_box_select_row` → `gtk_list_box_select_row_internal` (gtklistbox.c:1729-1749),
 * as `gtk_flow_box_select_child` for the other widget.
 *
 * NOT {@link listBoxSelect} with no modifiers, and the difference is in the early return:
 * a row that is ALREADY selected is left alone (:1735-1736), so the programmatic call is
 * idempotent where the click toggles. The anchor still moves to `position` on success, and
 * a `null` row is the C's "unselect everything" (:923-926), which is why the result is a
 * selection rather than a boolean.
 */
export function listBoxSelectRow(
    selection: AdwBoxSelection,
    anchor: number,
    position: number | null,
    length: number,
    mode: AdwBoxSelectionMode,
    selectable = true,
): AdwBoxSelectResult {
    const current = normalize(selection, length);

    if (mode === 'none') return { selection: current, anchor };
    if (position === null) return { selection: [], anchor: -1 };
    if (!selectable) return { selection: current, anchor };
    if (!Number.isInteger(position) || position < 0 || position >= length) return { selection: current, anchor };
    if (current.includes(position)) return { selection: current, anchor };

    // `!= GTK_SELECTION_MULTIPLE` clears first, which covers `browse` and `single` alike.
    return { selection: [position], anchor: position };
}

/**
 * `gtk_list_box_unselect_row` → `gtk_list_box_unselect_row_internal` (gtklistbox.c:1711-1726).
 *
 * The one thing worth reading twice is the NON-multiple branch: it does not clear just this
 * row, it clears the WHOLE box (:1719-1720). That is unreachable through a click — a click
 * selects, it never unselects alone — so it only shows up through this function, and a port
 * that narrowed to the one row would leave a single-selection box with several rows lit.
 * The C leaves the anchor alone here, and so does this.
 */
export function listBoxUnselectRow(
    selection: AdwBoxSelection,
    anchor: number,
    position: number,
    length: number,
    mode: AdwBoxSelectionMode,
): AdwBoxSelectResult {
    const current = normalize(selection, length);
    if (mode === 'none' || !current.includes(position)) return { selection: current, anchor };
    return { selection: mode === 'multiple' ? current.filter((p) => p !== position) : [], anchor };
}

/**
 * `gtk_list_box_select_all` (gtklistbox.c:958-971) — refused unless `multiple`.
 *
 * The `length > 0` guard is kept because the C emits `selected-rows-changed` ONLY when the
 * box has children (:966-970), and an empty box that emitted the signal would tell an
 * application the selection changed when nothing did.
 */
export function listBoxSelectAll(length: number, mode: AdwBoxSelectionMode): number[] | null {
    if (mode !== 'multiple' || length <= 0) return null;
    return Array.from({ length }, (_, index) => index);
}

/**
 * `gtk_list_box_unselect_all` (gtklistbox.c:979-996) — refused in `browse`, where something
 * is always selected, and a no-op in `none`, where nothing ever is.
 *
 * `null` is "no change", `[]` is "cleared". The caller distinguishes them because the C
 * does: `unselect_all` emits `row-selected` and `selected-rows-changed` only when `dirty`
 * is TRUE (:991-995), and `dirty` is the OR of every row actually changing state
 * (:1687-1708) — so unselecting an already-empty box is silent upstream and has to be
 * silent here or every application listening for the signal hears about nothing.
 */
export function listBoxUnselectAll(selection: AdwBoxSelection, mode: AdwBoxSelectionMode): number[] | null {
    if (mode === 'browse' || mode === 'none') return null;
    return selection.length === 0 ? null : [];
}
