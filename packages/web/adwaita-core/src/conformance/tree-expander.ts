// Tree-expander conformance vectors — the node arithmetic and the shortcut table every
// tree row is held to (ADR 0089).
//
// WHAT EACH TABLE PINS DOWN, and the defect it exists for:
//
//   LAYOUT     how many `indent` nodes precede the row, whether an `expander` node is
//              drawn, and the accessible LEVEL. The rows that matter are the ones where
//              the three disagree: with no expander drawn, `indent-for-icon` adds one to
//              the depth, and the level is computed AFTER that increment — so a leaf at
//              depth 0 reports level 2. A renderer that re-derives this gets the increment
//              right in the branch it tests and wrong in the other one.
//   SHORTCUTS  which `listitem.*` action a key press asks for, including the two the C
//              makes conditional: the arrows need `<Shift>` and read in the locale's text
//              direction, and Space toggles only with `<Ctrl>`.
//
// Reference: refs/gtk/gtk/gtktreeexpander.c:166-265 (gtk_tree_expander_update_for_list_row)
// Reference: refs/gtk/gtk/gtktreeexpander.c:654-691 (the keyboard shortcuts)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type {
    AdwTreeExpanderAction,
    AdwTreeExpanderIcon,
    AdwTreeExpanderKeyState,
    AdwTreeExpanderOptions,
    AdwTreeExpanderRow,
} from '../tree-expander.js';

/** One row under one set of the three properties, and the subtree it draws. */
export interface TreeExpanderLayoutVector {
    /** What the row establishes, in one sentence. */
    readonly rule: string;
    /** What the `Gtk.TreeListRow` says, or null for an expander with no row. */
    readonly row: AdwTreeExpanderRow | null;
    /** The three `Gtk.TreeExpander` properties, GTK's defaults where absent. */
    readonly options: AdwTreeExpanderOptions;
    /** How many `indent` nodes precede the expander and the child. */
    readonly indents: number;
    /** What the `expander` node is, or `none` where the row draws none. */
    readonly expander: AdwTreeExpanderIcon;
    /** `GTK_ACCESSIBLE_PROPERTY_LEVEL`, which the C notes "is >= 1". */
    readonly level: number;
}

export const TREE_EXPANDER_LAYOUT_VECTORS: readonly TreeExpanderLayoutVector[] = [
    {
        rule: 'an expander with no list row draws nothing and announces no level above the first',
        row: null,
        options: {},
        indents: 0,
        expander: 'none',
        level: 1,
    },
    {
        rule: 'a collapsed root row is one arrow and no indent',
        row: { depth: 0, expandable: true, expanded: false },
        options: {},
        indents: 0,
        expander: 'collapsed',
        level: 1,
    },
    {
        rule: 'an expanded row at depth 2 is two indents and a turned arrow',
        row: { depth: 2, expandable: true, expanded: true },
        options: {},
        indents: 2,
        expander: 'expanded',
        level: 3,
    },
    {
        // The leaf branch increments the depth, so a leaf's text starts where its
        // expandable siblings' text does instead of an arrow-width to its left.
        rule: 'a leaf takes one more indent in place of the arrow',
        row: { depth: 1, expandable: false, expanded: false },
        options: {},
        indents: 2,
        expander: 'none',
        level: 3,
    },
    {
        rule: 'indent-for-icon off leaves the leaf un-indented and one level lower',
        row: { depth: 1, expandable: false, expanded: false },
        options: { indentForIcon: false },
        indents: 1,
        expander: 'none',
        level: 2,
    },
    {
        rule: 'a hidden expander takes the leaf branch, expandable or not',
        row: { depth: 1, expandable: true, expanded: true },
        options: { hideExpander: true },
        indents: 2,
        expander: 'none',
        level: 3,
    },
    {
        rule: 'indent-for-depth off stops the indent growing but keeps the arrow',
        row: { depth: 3, expandable: true, expanded: true },
        options: { indentForDepth: false },
        indents: 0,
        expander: 'expanded',
        level: 1,
    },
    {
        // Both properties off on a leaf: no depth and no icon allowance, which is the only
        // combination that draws a tree row with nothing in front of it at all.
        rule: 'both indents off on a leaf draw no ornament whatsoever',
        row: { depth: 2, expandable: false, expanded: false },
        options: { indentForDepth: false, indentForIcon: false },
        indents: 0,
        expander: 'none',
        level: 1,
    },
];

/** One key press under one modifier state, and the action it asks for. */
export interface TreeExpanderShortcutVector {
    /** What the row establishes, in one sentence. */
    readonly rule: string;
    /** The `KeyboardEvent.key` value. */
    readonly key: string;
    /** The modifiers and the text direction. */
    readonly state: AdwTreeExpanderKeyState;
    /** The `listitem.*` action, or `none`. */
    readonly action: AdwTreeExpanderAction;
}

export const TREE_EXPANDER_SHORTCUT_VECTORS: readonly TreeExpanderShortcutVector[] = [
    { rule: 'plus expands', key: '+', state: {}, action: 'expand' },
    { rule: 'asterisk expands', key: '*', state: {}, action: 'expand' },
    { rule: 'minus collapses', key: '-', state: {}, action: 'collapse' },
    { rule: 'slash collapses', key: '/', state: {}, action: 'collapse' },
    { rule: 'Ctrl+Space toggles', key: ' ', state: { ctrlKey: true }, action: 'toggle' },
    { rule: 'a bare Space is the list view s, not the expander s', key: ' ', state: {}, action: 'none' },
    { rule: 'a bare arrow moves the cursor and does not expand', key: 'ArrowRight', state: {}, action: 'none' },
    {
        rule: 'Shift+Right expands in a left-to-right locale',
        key: 'ArrowRight',
        state: { shiftKey: true },
        action: 'expand',
    },
    {
        rule: 'Shift+Left collapses in a left-to-right locale',
        key: 'ArrowLeft',
        state: { shiftKey: true },
        action: 'collapse',
    },
    {
        rule: 'the two arrows swap in a right-to-left locale',
        key: 'ArrowRight',
        state: { shiftKey: true, rtl: true },
        action: 'collapse',
    },
    {
        rule: 'and so does the other one',
        key: 'ArrowLeft',
        state: { shiftKey: true, rtl: true },
        action: 'expand',
    },
    {
        rule: 'an unrelated key asks for nothing, modifiers or not',
        key: 'a',
        state: { shiftKey: true, ctrlKey: true },
        action: 'none',
    },
];
