// Which conformance vectors an AUTHORED WIDGET TREE reaches — the renderer-free half of
// ADR 0051.
//
// WHAT THIS IS FOR. `scripts/adwaita-gallery-shared-trees.mjs` holds gallery blocks whose
// widget tree is authored ONCE, in GIR class names, and rendered by more than one surface.
// Arm 11 of `check-generated-website-data.mjs` compares those trees as DATA. What nothing
// held was whether the RENDERERS behave the same on them — ADR 0027 § 9's criterion. A
// driver per renderer builds the tree and asserts what this module derives from it.
//
// IT INVENTS NO EXPECTATION, and that is the whole design (ADR 0051 § 3). Every value a
// driver asserts comes out of a vector table that already exists, so a failure is
// attributable to the RENDERER rather than to an assertion written next to it. This module
// only answers "which rows does this tree instantiate", and it answers it by MATCHING the
// authored value against the row's input — never by classifying, never by re-deriving.
//
// WHY EXACT MATCHING AND NOT "THE RULE APPLIES". A rule-based reader would have to decide
// which row a value is LIKE, which is a second implementation of the derivation the vectors
// exist to pin down: it would agree with whatever it re-implemented, and the tree could
// then be green against a renderer that is wrong. Exact matching cannot do that. Its cost
// is coverage — most authored values are not vector inputs — and the cost is PRINTED by the
// drivers rather than hidden, because a suite whose denominator is invisible claims more
// than it measures.
//
// WHAT A TREE DRIVER STRUCTURALLY CANNOT REACH, measured rather than assumed:
//
//   · A `GParamSpec`-default table. `BANNER_DEFAULT_VECTORS` states the pspec defaults, and
//     a tree driver reads a CONSTRUCTED widget. The two are different facts and they
//     disagree: measured on libadwaita 1.9.3, `AdwBanner`'s `use-markup` pspec default is
//     TRUE while a freshly constructed `AdwBanner` answers FALSE (`get_use_markup()` and
//     `get_property` agree with each other). `gtk-host`'s README already names that class —
//     construction and the pspec disagree in a hundred-odd places — so reading a pspec
//     table off a built widget would assert the wrong one of two true things.
//   · A table whose expectation is a LOCALIZED rendering. `SHORTCUT_LABEL_VECTORS` spells
//     its keycaps in English; `Adw.ShortcutLabel` renders `gtk_accelerator_get_label`,
//     which is translated. Measured: `<Control>C` draws `["Strg","C"]` on a de_DE host and
//     `["Ctrl","C"]` under `LC_ALL=C`, and the locale cannot be changed from inside the
//     process — `GLib.setenv` after `Gtk.init` moves neither. Asserting the row would
//     assert a fact about the RUNNER, the same class `isEnvironmentDiagnostic` exists for.
//   · The `emitted` half of a notify table. A tree authors a property, it does not author a
//     listener attached before the write, so only the END STATE of such a row is reachable.
//
// Reference: refs/libadwaita/src/adw-entry-row.c, adw-switch-row.c, adw-banner.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { BANNER_BUTTON_TEXT_VECTORS, BANNER_BUTTON_VISIBLE_VECTORS } from './banner.js';
import { ENTRY_TEXT_LENGTH_VECTORS } from './entry-row.js';
import { SWITCH_ROW_NOTIFY_VECTORS } from './action-row.js';

/** One node of an authored tree — the shape `ADWAITA_GALLERY_SHARED_TREES` is written in. */
export interface SharedTreeNode {
    /** A GIR class name, e.g. `AdwPreferencesGroup`. */
    tag: string;
    slot?: string;
    props?: Readonly<Record<string, string | number | boolean>>;
    children?: readonly SharedTreeNode[];
}

/**
 * What a renderer must be able to READ off the widget it built.
 *
 * A closed vocabulary on purpose: it is the seam between this renderer-free module and the
 * per-renderer drivers, and an open one would let a driver answer a question nobody else
 * answers. Each name says WHICH widget and WHICH observation, never how to make it.
 */
export type SharedTreeObservable =
    /** `adw_entry_row_get_text_length` — characters, not UTF-16 units. */
    | 'entry-text-length'
    /** `Adw.SwitchRow:active` after the tree's own write. */
    | 'switch-row-active'
    /** Whether the banner's action button is on screen. */
    | 'banner-button-visible'
    /** The text painted in the banner's action button, after mnemonic resolution. */
    | 'banner-button-text';

/** One vector row an authored node instantiates, addressed to the renderer that built it. */
export interface SharedTreeExpectation {
    /** Pre-order address inside the block, e.g. `AdwPreferencesGroup > AdwSwitchRow[1]`. */
    path: string;
    /** The GIR class of the node this is about. */
    gtype: string;
    /** The conformance table the row comes from — the name, so a failure cites its source. */
    table: string;
    observable: SharedTreeObservable;
    expected: string | number | boolean;
    /** The row's own `rule`, which is also the test title. */
    rule: string;
}

/**
 * The tables this module joins an authored tree against.
 *
 * NAMED IN CODE rather than in prose, because `check-adwaita-conformance-drivers.mjs` reads
 * this list to decide which tables a tree driver drives. A table added here that no corpus
 * node reaches fails the drivers' own suite — see `reachedTables` below, which is DERIVED
 * from the corpus and not written down.
 */
export const SHARED_TREE_TABLES = [
    'BANNER_BUTTON_TEXT_VECTORS',
    'BANNER_BUTTON_VISIBLE_VECTORS',
    'ENTRY_TEXT_LENGTH_VECTORS',
    'SWITCH_ROW_NOTIFY_VECTORS',
] as const;

/**
 * Blocks that reach NO vector row, with the measured reason — ADR 0051 § 4.
 *
 * A block in the corpus that proves nothing must SAY so, or the pass count reads as
 * coverage it does not have. Self-retiring: a driver fails on a declared block that has
 * started reaching a row, the same shape as arm 11's stale-divergence rule.
 */
export const SHARED_TREE_BLOCKS_WITHOUT_VECTORS: Readonly<Record<string, string>> = {
    'Adw.ShortcutLabel':
        'its only table, SHORTCUT_LABEL_VECTORS, spells keycaps in English while the widget renders ' +
        'gtk_accelerator_get_label, which is translated — see the header. The browser renderer drives ' +
        'the table from its own spec, where nothing translates.',
    'Adw.WindowTitle':
        'WINDOW_TITLE_VECTORS is a STEP table over a fresh widget and its rows spell their own titles; ' +
        'the authored "Inbox"/"3 unread messages" is no row\'s input, and LABEL_VISIBILITY_VECTORS keys ' +
        'on the label TEXT for the same reason.',
};

/** The steps a {@link SWITCH_ROW_NOTIFY_VECTORS} row would have to be, for an authored `active`. */
const switchRowRowFor = (active: boolean | undefined) =>
    SWITCH_ROW_NOTIFY_VECTORS.find((vector) =>
        active === undefined
            ? vector.steps.length === 0
            : vector.steps.length === 1 &&
              vector.steps[0]!.op === 'set-active' &&
              (vector.steps[0] as { active: boolean }).active === active,
    );

/** The rows one node instantiates — no recursion, so the address is the caller's to build. */
function expectationsForNode(node: SharedTreeNode, path: string): SharedTreeExpectation[] {
    const props = node.props ?? {};
    const found: SharedTreeExpectation[] = [];
    const at = (
        table: string,
        observable: SharedTreeObservable,
        expected: string | number | boolean,
        rule: string,
    ) => found.push({ path, gtype: node.tag, table, observable, expected, rule });

    if (node.tag === 'AdwEntryRow') {
        // An unset `text` is the empty entry, which is a row of the table like any other.
        const text = typeof props.text === 'string' ? props.text : '';
        const row = ENTRY_TEXT_LENGTH_VECTORS.find((vector) => vector.text === text);
        if (row) at('ENTRY_TEXT_LENGTH_VECTORS', 'entry-text-length', row.length, row.rule);
    }

    if (node.tag === 'AdwSwitchRow') {
        const active = typeof props.active === 'boolean' ? props.active : undefined;
        const row = switchRowRowFor(active);
        // Only the END STATE: `emitted` needs a listener attached before the write, and an
        // authored tree has nowhere to put one — see the header.
        if (row) at('SWITCH_ROW_NOTIFY_VECTORS', 'switch-row-active', row.active, row.rule);
    }

    if (node.tag === 'AdwBanner') {
        const label = typeof props.buttonLabel === 'string' ? props.buttonLabel : undefined;
        if (label !== undefined) {
            const visible = BANNER_BUTTON_VISIBLE_VECTORS.find((vector) => vector.label === label);
            if (visible) at('BANNER_BUTTON_VISIBLE_VECTORS', 'banner-button-visible', visible.visible, visible.rule);
            const text = BANNER_BUTTON_TEXT_VECTORS.find((vector) => vector.label === label);
            if (text) at('BANNER_BUTTON_TEXT_VECTORS', 'banner-button-text', text.text, text.rule);
        }
    }

    return found;
}

/** Pre-order walk, carrying the address a failure has to name. */
function walk(node: SharedTreeNode, path: string, visit: (node: SharedTreeNode, path: string) => void): void {
    visit(node, path);
    (node.children ?? []).forEach((child, index) => walk(child, `${path} > ${child.tag}[${index}]`, visit));
}

/** Every authored node of `root`, in pre-order — the sequence a realised tree must reproduce. */
export function authoredNodes(root: SharedTreeNode): { node: SharedTreeNode; path: string }[] {
    const found: { node: SharedTreeNode; path: string }[] = [];
    walk(root, root.tag, (node, path) => found.push({ node, path }));
    return found;
}

/** Every vector row the tree rooted at `root` instantiates, in pre-order. */
export function sharedTreeExpectations(root: SharedTreeNode): SharedTreeExpectation[] {
    const found: SharedTreeExpectation[] = [];
    walk(root, root.tag, (node, path) => found.push(...expectationsForNode(node, path)));
    return found;
}

/**
 * The tables the CORPUS actually reaches, derived from the trees themselves.
 *
 * The counterweight to {@link SHARED_TREE_TABLES}: that list is a claim about what this
 * module joins, this is what the corpus delivers. A driver holding them against each other
 * is what stops a table being listed as tree-driven while no tree touches it — the false
 * coverage class `check-adwaita-conformance-drivers.mjs`'s three incidents are all about.
 */
export function reachedTables(roots: readonly SharedTreeNode[]): string[] {
    const seen = new Set<string>();
    for (const root of roots) for (const expectation of sharedTreeExpectations(root)) seen.add(expectation.table);
    return [...seen].sort();
}
