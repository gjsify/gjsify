// `Gtk.TreeExpander`'s node arithmetic and its keyboard shortcuts — headless (ADR 0004,
// ADR 0089).
//
// WHY THIS IS IN CORE AND THE SEPARATOR IS NOT. A separator reads one property and sets
// one class; this widget DERIVES its whole subtree from six inputs, and the derivation is
// `gtk_tree_expander_update_for_list_row` (gtktreeexpander.c:166-265) — a function with
// two branches, an off-by-one that only the `indent-for-icon` branch takes, and an
// accessibility level computed AFTER that increment. A renderer that re-derives it gets
// the increment wrong in the branch it tests least, which is precisely the shape ADR 0004
// says belongs here.
//
// THE `Gtk.TreeListRow` IS NOT PORTED, and that is the decision ADR 0089 records. Upstream
// the expander WATCHES a row object produced by a `GtkTreeListModel`'s create-model
// callback: a function from an item to its children's model, lazily, with the parent
// chain held by the model. Porting the object would mean porting the model, and ADR 0046
// § 7 already refused the sorting/filtering/virtualisation half of that for the same
// reason. What the expander actually READS off the row is three numbers
// ({@link AdwTreeExpanderRow}), so three numbers are what crosses — the same reduction
// `AdwListModel` is of `Gio.ListModel`.
//
// Reference: refs/gtk/gtk/gtktreeexpander.c:166-265 (gtk_tree_expander_update_for_list_row)
// Reference: refs/gtk/gtk/gtktreeexpander.c:654-691 (the keyboard shortcuts)
// Reference: refs/libadwaita/src/stylesheet/widgets/_expanders.scss (the expander node)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.

/**
 * What a `Gtk.TreeListRow` tells the expander — depth, expandability, expanded state.
 *
 * `gtk_tree_list_row_get_depth` is 0 for a root row, so a three-level tree runs 0, 1, 2 —
 * and `is_expandable` is independent of `expanded`: a collapsed row whose children the
 * model has not built yet is still expandable.
 */
export interface AdwTreeExpanderRow {
    /** `gtk_tree_list_row_get_depth` — 0 at the root. */
    readonly depth: number;
    /** `gtk_tree_list_row_is_expandable`. */
    readonly expandable: boolean;
    /** `Gtk.TreeListRow:expanded`. */
    readonly expanded: boolean;
}

/** The three properties that shape the expander, in GTK's own defaults. */
export interface AdwTreeExpanderOptions {
    /** `Gtk.TreeExpander:hide-expander` — default FALSE. */
    readonly hideExpander?: boolean;
    /** `Gtk.TreeExpander:indent-for-depth` — default TRUE (gtktreeexpander.c:750). */
    readonly indentForDepth?: boolean;
    /** `Gtk.TreeExpander:indent-for-icon` — default TRUE (gtktreeexpander.c:749). */
    readonly indentForIcon?: boolean;
}

/** What the expander node is, when there is one. */
export type AdwTreeExpanderIcon = 'none' | 'collapsed' | 'expanded';

/** The subtree one expander draws, as counts rather than nodes. */
export interface AdwTreeExpanderLayout {
    /** How many `indent` nodes precede the expander/child. */
    readonly indents: number;
    /** The `expander` node's state — `none` when the row draws no expander at all. */
    readonly expander: AdwTreeExpanderIcon;
    /** `GTK_ACCESSIBLE_PROPERTY_LEVEL`, which "is >= 1" (gtktreeexpander.c:264). */
    readonly level: number;
}

/** A row with no list row at all — the `list_row == NULL` branch, which unparents everything. */
const EMPTY_LAYOUT: AdwTreeExpanderLayout = { indents: 0, expander: 'none', level: 1 };

/**
 * The nodes one expander draws — `gtk_tree_expander_update_for_list_row`
 * (gtktreeexpander.c:166-265), as a pure function.
 *
 * Read off the C in its own order, because the order is where the subtlety is:
 *
 *   1. `depth = indent_for_depth ? row.depth : 0`. Turning the property off does not hide
 *      the expander, it only stops the INDENT growing with the level;
 *   2. an expander node exists when the row `is_expandable` AND `hide-expander` is off,
 *      and carries `:checked` when the row is expanded — which is also the
 *      `aria-expanded` state;
 *   3. with NO expander, `indent_for_icon` adds ONE to the depth, so a leaf lines up with
 *      its expandable siblings' content instead of sitting an icon-width to their left.
 *      It is the only place the count differs from the level, and it applies to a
 *      hide-expander row as much as to a leaf;
 *   4. `level` is `depth + 1` and is computed AFTER that increment, so a leaf at depth 0
 *      with `indent-for-icon` on reports level 2. That is upstream's arithmetic, not a
 *      transcription slip: the C writes `depth + 1` at the end of the same block.
 *
 * A null row is `EMPTY_LAYOUT`: GTK unparents every indent and the expander, leaving the
 * child alone, and resets the expanded state.
 */
export function treeExpanderLayout(
    row: AdwTreeExpanderRow | null | undefined,
    options: AdwTreeExpanderOptions = {},
): AdwTreeExpanderLayout {
    if (!row) return EMPTY_LAYOUT;
    const indentForDepth = options.indentForDepth !== false;
    const indentForIcon = options.indentForIcon !== false;
    const hideExpander = options.hideExpander === true;

    let depth = indentForDepth ? Math.max(0, Math.floor(row.depth)) : 0;
    const drawsExpander = row.expandable && !hideExpander;
    if (!drawsExpander && indentForIcon) depth++;

    return {
        indents: depth,
        expander: drawsExpander ? (row.expanded ? 'expanded' : 'collapsed') : 'none',
        level: depth + 1,
    };
}

/** What a key press on an expander asks for. */
export type AdwTreeExpanderAction = 'expand' | 'collapse' | 'toggle' | 'none';

/** The modifier state a shortcut is read against. */
export interface AdwTreeExpanderKeyState {
    /** `GDK_CONTROL_MASK`. */
    readonly ctrlKey?: boolean;
    /** `GDK_SHIFT_MASK`. */
    readonly shiftKey?: boolean;
    /** Right-to-left text direction, which swaps the two arrows. */
    readonly rtl?: boolean;
}

/**
 * One key press → the `listitem.*` action it maps to (gtktreeexpander.c:654-691).
 *
 * `+` and `*` expand, `-` and `/` collapse, Ctrl+Space toggles; the arrows expand or
 * collapse with Shift or Ctrl+Shift, in the direction the locale reads
 * (`expand_collapse_right` is EXPAND in LTR). The keypad duplicates upstream declares
 * (`KP_Add`, `KP_Multiply`, …) need no entry: a browser reports the same `key` value for
 * a keypad `+` as for the main one, and distinguishing them would need `code`.
 *
 * Backspace — "go to parent row" — is `#if 0` in the C and is therefore not here either.
 */
export function treeExpanderAction(key: string, state: AdwTreeExpanderKeyState = {}): AdwTreeExpanderAction {
    if (key === '+' || key === '*') return 'expand';
    if (key === '-' || key === '/') return 'collapse';
    if (key === ' ' && state.ctrlKey === true) return 'toggle';
    if (state.shiftKey !== true) return 'none';
    const rtl = state.rtl === true;
    if (key === 'ArrowRight') return rtl ? 'collapse' : 'expand';
    if (key === 'ArrowLeft') return rtl ? 'expand' : 'collapse';
    return 'none';
}

/** Apply an action to an expanded flag — `listitem.expand`/`collapse`/`toggle-expand`. */
export function treeExpanderExpanded(expanded: boolean, action: AdwTreeExpanderAction): boolean {
    switch (action) {
        case 'expand':
            return true;
        case 'collapse':
            return false;
        case 'toggle':
            return !expanded;
        case 'none':
            return expanded;
    }
}
