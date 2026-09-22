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
//     TRUE while a freshly constructed `AdwBanner` answers FALSE. The mechanism is measured
//     too — the banner's getter reads its template `GtkLabel`, whose own `use-markup`
//     default is FALSE and which the pspec default never writes: assigning the internal
//     label's property directly moves what the banner reports. `gtk-host`'s README already
//     names that class — construction and the pspec disagree in a hundred-odd places — so
//     reading a pspec table off a built widget would assert the wrong one of two true
//     things. What the ports do with it is `status/open-todos.md`'s, not this module's.
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

/**
 * One node of an authored tree — the shape `ADWAITA_GALLERY_SHARED_TREES` is written in.
 *
 * THIS DECLARATION IS THE ORIGINAL. Every other spelling of the shape in this repository
 * restates it — `scripts/adwaita-gallery-shared-trees.d.mts` for the plain-Node generators,
 * `packages/infra/blueprint/src/shared-node.d.mts` for the projection, and more besides —
 * each because it cannot import from here, each saying why in its own header.
 * `scripts/check-shared-tree-shape.mjs` carries the list, holds every entry to this
 * declaration field by field, and fails on a spelling that declares itself nowhere. So a
 * field added here is added there too, or the gate says which field and where.
 */
export interface SharedTreeNode {
    /** A GIR class name, e.g. `AdwPreferencesGroup`. */
    tag: string;
    /**
     * The name this node is addressed by from OUTSIDE the tree.
     *
     * Renderer-neutral because every surface already has one — a GtkBuilder object id, a DOM
     * `id`, a NativeScript `id` — and worth carrying although `bind` stays a refusal: measured
     * in ADR 0066, EVERY id in this repository's shipped `.blp` is named by the sibling
     * TypeScript through `InternalChildren` and NONE by a `bind` inside the file. A name read
     * from outside is the component's addressing surface, not an input to a binding language.
     */
    id?: string;
    /**
     * On the ROOT node: the composite class this tree DEFINES, where `tag` is the type it
     * extends.
     *
     * `template $GalleryHeaderBar : Adw.Bin` is `{ tag: 'AdwBin', template: 'GalleryHeaderBar' }`
     * — two facts that a single tag cannot carry, which is why the root of every shipped `.blp`
     * projected to its PARENT type and said nothing about the class the file is about. The value
     * is what GtkBuilder writes as `<template class="…">`, so `emitGtkBuilderXml` and the
     * projection can be held against each other on it — and are, by stage D's addressing arm.
     */
    template?: string;
    /**
     * Where in the parent this child goes — the placement, spelled as the GTK side spells it.
     *
     * ONE FIELD FOR TWO GtkBuilder CONSTRUCTS, and the conflation is the projection's, not a
     * choice made here: `[start]` is `<child type="start">` and `content: …` is a
     * property-valued child, and both land on this field, so it cannot be inverted (the
     * Blueprint corpus's `expectations.mjs` states it as finding 1). A renderer therefore has
     * to answer to both spellings of a placement it has — `gtk-host` derives the property name
     * from its own `set_`-prefixed slot method, `<adw-header-bar>` names `title-widget` beside
     * its own `center`.
     *
     * A SHARED TREE MAY CARRY ONE ONLY WHERE EVERY RENDERER SPELLS IT THE SAME. That is the
     * corpus's no-alias admission rule applied to a placement, and it is narrow: a row's
     * `prefix`/`suffix` qualify, a header bar's `start`/`title`/`end` do not
     * (`startBox`/`titleWidget`/`endBox` on the NativeScript port), which is why those blocks
     * are ledgered as `vocabulary` divergences. A renderer handed a name it has no destination
     * for REFUSES and says which — the alternative was measured on a shipped `.blp`, where a
     * `[top]` header bar landed in the content and the window title was then discarded by the
     * bar's own construction, at exit 0.
     */
    slot?: string;
    props?: Readonly<Record<string, string | number | boolean>>;
    /**
     * Which of this node's `props` are marked for translation, keyed by the prop name.
     *
     * A present key means marked; `context` carries the message context `C_("noun", …)` gives
     * one. BESIDE `props` and not inside it, because that is what the marking is wherever a
     * surface has one: GtkBuilder writes `translatable="yes" context="noun"` as attributes NEXT
     * to the value, and a marked value is still the same value. Widening `props` to a union
     * would make every reader of a value narrow past something that is not one.
     *
     * Worth carrying although no renderer here translates: a caption whose marking was dropped
     * looks finished and is unreachable by `xgettext`, which is the exact defect ADR 0033 gives
     * as its reason for preferring a declarative template. ADR 0067 measures it and says why
     * the file-level `translation-domain` is not a node fact and stays a loss.
     */
    translatable?: Readonly<Record<string, { readonly context?: string }>>;
    /**
     * The style classes this node carries, as a list, in the order the source wrote them.
     *
     * ONE FIELD FOR TWO SPELLINGS, because they are one GTK property. Blueprint writes
     * `styles ["flat", "circular"]` as a block and `css-classes: ["flat", "narrow"]` as a
     * property value, and both set `GtkWidget:css-classes` — measured against the reference
     * compiler, which writes the first as `<style><class name="flat"/></style>` and the second
     * as a `<property>` whose text is NEWLINE-joined. A joined string in `props` would have to
     * pick one of those two joins and could then not be held against the other golden, which is
     * why the list is the field and not a string (ADR 0068 § 2).
     *
     * `styleClasses` and not `cssClasses`: ADR 0049 § 1 measured that name fatal on
     * NativeScript, where `ViewBase` owns it as a live `Set` its CSS engine reads. So the field
     * carries the name the three surfaces CAN share, and each driver maps it to its own door —
     * the same arrangement `slot` already has, where GTK writes `<child type="start">` and the
     * web writes `slot="start"`.
     */
    styleClasses?: readonly string[];
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
 *
 * A reason has to name the mechanism, not a consequence of it: the two below reach nothing
 * for DIFFERENT reasons — one table is not joined, the other's rows do not match the
 * authored values — and a declaration that blurs them is a silence nobody can retire.
 */
export const SHARED_TREE_BLOCKS_WITHOUT_EXPECTATIONS: Readonly<Record<string, string>> = {
    'Adw.ShortcutLabel':
        'a CHOICE, not an impossibility: SHORTCUT_LABEL_VECTORS is deliberately off SHARED_TREE_TABLES, ' +
        'because the row this block would instantiate is unreadable on a translated host — see the header. ' +
        'What that costs is one-sided. `adwaita-web` drives the table from its own spec and would pass the ' +
        "row here too; `gtk-host` drives it from NO spec, so libadwaita's own keycap rendering is the one " +
        'thing this declaration leaves unchecked. Joining it wants `it.failing(…, { when: <translated host> })` ' +
        'per tests/AGENTS.md rule 6 — a tolerated failure on a de_DE desk, a REAL assertion anywhere the host ' +
        'is untranslated, which no workflow here opts out of.',
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
    const at = (table: string, observable: SharedTreeObservable, expected: string | number | boolean, rule: string) =>
        found.push({ path, gtype: node.tag, table, observable, expected, rule });

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

/**
 * The authored classes a realised tree must carry, in authored order.
 *
 * `tagOf` is the renderer's own spelling of a GIR class name — `hostTagOf` from the sibling
 * `@gjsify/adwaita-core/tags` on the web, the GIR name itself in GTK. Both drivers filter
 * their real tree down to this list and compare against it, so it lives here rather than in
 * each of them: a driver deriving it privately is a second walk, free to disagree with the
 * one {@link subjectIndexOf} addresses into.
 */
export function authoredTags(root: SharedTreeNode, tagOf: (gtype: string) => string = (gtype) => gtype): string[] {
    return authoredNodes(root).map(({ node }) => tagOf(node.tag));
}

/** One authored placement: the node's address, and the slot it named. */
export interface SharedTreePlacement {
    /** The pre-order address {@link subjectIndexOf} reads, so a failure names a node. */
    path: string;
    /** The slot the tree authored, spelled the way every renderer admitting the block spells it. */
    slot: string;
}

/**
 * Every node of `root` that names a placement.
 *
 * WHAT THIS IS FOR. A driver comparing only the authored classes IN ORDER cannot see a
 * slot at all: a child placed in the wrong slot of the right parent keeps every authored
 * node in every authored position. ADR 0051 § Amendment 3 measured exactly that on the
 * NativeScript port — two deliberate mis-placements, both GREEN — and the corpus authored
 * no slot to catch it with until one did. This is the renderer-free half of the answer;
 * what a driver DOES with it is its own, because "the child ended up in slot X" has no
 * shared observable.
 */
export function sharedTreePlacements(root: SharedTreeNode): SharedTreePlacement[] {
    return authoredNodes(root)
        .filter(({ node }) => node.slot !== undefined)
        .map(({ node, path }) => ({ path, slot: node.slot as string }));
}

/**
 * The same tree with every placement dropped — what a renderer that never read `slot`
 * builds.
 *
 * THE CONTROL, and it is why a placement assertion can be made without a per-widget table
 * of where each slot lands. A driver builds the tree twice and asserts the two REALISED
 * trees differ: with the slots honoured a suffix sits in its row's header, without them it
 * sits wherever that parent's default placement puts it. Every builder here read only
 * `tag`, `props` and `children`, so the two builds were byte-identical — which is the
 * regression this control turns red.
 *
 * Fresh nodes all the way down, never the authored ones: a driver handed the corpus's own
 * objects could edit what the next block builds.
 */
export function withoutPlacements(root: SharedTreeNode): SharedTreeNode {
    const { slot: _dropped, children, ...rest } = root;
    return { ...rest, ...(children === undefined ? {} : { children: children.map(withoutPlacements) }) };
}

/**
 * Where the node an expectation is about sits in that filtered walk.
 *
 * The pre-order addresses are unique and the filter preserves them, so this index into
 * {@link authoredTags} is also the index into the realised tree — which is why a driver may
 * pick its subject by position instead of by hunting for the first widget of the class. Both
 * halves of that are asserted on Node in `shared-trees.spec.ts`, before either renderer
 * relies on them.
 */
export function subjectIndexOf(root: SharedTreeNode, path: string): number {
    return authoredNodes(root).findIndex((node) => node.path === path);
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
