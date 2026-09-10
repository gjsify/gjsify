// ONE AUTHORED TREE, BUILT BY THIS RENDERER — ADR 0051, the GTK half of ADR 0027 § 9.
//
// The corpus is `scripts/adwaita-gallery-shared-trees.mjs`, read here rather than copied:
// the same file the two gallery generators emit from, so a block cannot be tested in one
// shape and shipped in another. The only transform on the way in is `gtkHostTree`, which is
// this package's own `tagOf` — one deterministic case rule, no alias table, and no per-block
// branch anywhere below.
//
// What this asserts that the per-widget specs cannot. Every other spec in this package
// constructs its subject itself, so it proves the host can drive a widget somebody wrote a
// test for. Here the widget arrives out of a tree NEITHER renderer authored: it is created
// by tag, propertied by authored name, parented by the descriptor's own child policy, and
// only then read. A mis-parenting, a property name that resolves to the wrong GObject
// property, or a placement that silently replaces a template child fails here on a tree the
// website ships.
//
// The expectations are `@gjsify/adwaita-core`'s, joined to the tree by
// `sharedTreeExpectations` — this file writes NO expected value of its own, which is what
// makes a failure attributable to the renderer. What a tree driver structurally cannot
// reach, and why, is in that module's header.
//
// THE READERS GO THROUGH THE REAL GTK TREE (`descendants`, `findDescendant`), never the
// host's shadow links: a renderer asserting against its own bookkeeping agrees with itself
// while the window is wrong.

import { expect, it, on } from '@gjsify/unit';

import type Adw from '@girs/adw-1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    SHARED_TREE_BLOCKS_WITHOUT_EXPECTATIONS,
    SHARED_TREE_TABLES,
    authoredNodes,
    reachedTables,
    sharedTreeExpectations,
    type SharedTreeExpectation,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';

import { ADWAITA_GALLERY_SHARED_TREES, gtkHostTree } from '../../../../scripts/adwaita-gallery-shared-trees.mjs';
import { descendants, findDescendant, installDiagnosticsGate } from './conformance/index.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { createElement, insert, materialize } from './host.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import type { HostElement } from './types.js';

/**
 * The whole renderer-specific half of this driver: a tag, its authored properties, its
 * children, in that order.
 *
 * Recursive and total — no tag list, no property list, no per-block case. The authored
 * property NAMES go to `setProp` verbatim (through `createElement`), which is the point:
 * `buttonLabel` reaching `button-label` is the host's own coercion, and a driver spelling
 * the GObject name itself would be testing its own translation table.
 */
function build(node: SharedTreeNode): HostElement {
    const el = createElement(node.tag, node.props as Record<string, unknown> | undefined);
    materialize(el);
    for (const child of node.children ?? []) insert(build(child), el);
    return el;
}

const widgetOf = (el: HostElement) => materialize(el) as unknown as Gtk.Widget;
const typeName = (widget: Gtk.Widget) =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ?? '';

/**
 * Read one observable off the widget this renderer built.
 *
 * The ONE seam between the shared expectations and this renderer — `StoryViewBase<TNode>`'s
 * shape, applied to a read instead of a chrome. Everything above it is renderer-free and
 * everything below it is GTK; a `switch` that grew a block name would be the per-surface
 * branch ADR 0027 § 9 forbids.
 */
function read(expectation: SharedTreeExpectation, widget: Gtk.Widget): string | number | boolean {
    switch (expectation.observable) {
        case 'entry-text-length':
            return (widget as unknown as Adw.EntryRow).textLength;
        case 'switch-row-active':
            return (widget as unknown as Adw.SwitchRow).active;
        case 'banner-button-visible':
            return bannerButton(widget)?.visible ?? false;
        case 'banner-button-text':
            // `get_text()` and not `label`: the banner template pins the button to
            // `use-underline=True`, so `label` still carries the mnemonic marker while
            // `get_text()` is what is painted — which is what the vector states.
            return bannerLabel(widget)?.get_text() ?? '';
    }
}

/** The banner's action button, reached through the REAL tree — it is a template child. */
const bannerButton = (banner: Gtk.Widget): Gtk.Widget | null =>
    findDescendant(banner, (widget) => widget instanceof Gtk.Button);

const bannerLabel = (banner: Gtk.Widget): Gtk.Label | null => {
    const button = bannerButton(banner);
    return button ? (findDescendant(button, (widget) => widget instanceof Gtk.Label) as Gtk.Label | null) : null;
};

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();

        // GTK's failure mode is exit 0. Without this a block that mis-parents reports ✔
        // while GTK prints a critical, which is the entire class this driver exists to see.
        const diagnostics = installDiagnosticsGate();

        const blocks = ADWAITA_GALLERY_SHARED_TREES.map((tree) => gtkHostTree(tree.widget));
        // Authored GIR names, because the shape assertion below reads GTypes off the real
        // tree; `gtkHostTree` has already turned the tags into this renderer's spelling.
        const authored = ADWAITA_GALLERY_SHARED_TREES.map((tree) => tree.root);

        await gated(diagnostics, 'the shared corpus builds through gtk-host', async () => {
            for (const [index, block] of blocks.entries()) {
                const widget = ADWAITA_GALLERY_SHARED_TREES[index]!.widget;

                await it(`${widget} builds, and the REAL tree carries the authored nodes in order`, () => {
                    const root = widgetOf(build(block.root));

                    // The authored GTypes, in the order the authored tree names them.
                    const wanted = authoredNodes(authored[index]!).map(({ node }) => node.tag);
                    const set = new Set(wanted);
                    // Depth-first over the real tree, filtered to the authored classes: the
                    // libadwaita internals between them (a revealer, a listbox, a gizmo) are
                    // not the renderer's promise, the ORDER and the NESTING of what was
                    // authored is. Exact type names, so a subclass cannot stand in.
                    const built = descendants(root)
                        .map(typeName)
                        .filter((name) => set.has(name));

                    expect(built).toStrictEqual(wanted);
                });
            }
        });

        await gated(diagnostics, 'the shared corpus against the adwaita-core vectors it reaches', async () => {
            for (const [index, block] of blocks.entries()) {
                const widget = ADWAITA_GALLERY_SHARED_TREES[index]!.widget;
                const expectations = sharedTreeExpectations(authored[index]!);

                for (const expectation of expectations) {
                    await it(`${widget} — ${expectation.path}: ${expectation.table} — ${expectation.rule}`, () => {
                        const root = widgetOf(build(block.root));
                        const nodes = authoredNodes(authored[index]!);
                        // The SAME filtered walk the shape test asserts, so the widget an
                        // expectation is read off is the one at the authored ADDRESS rather
                        // than the first of its class the tree happens to contain.
                        const set = new Set(nodes.map(({ node }) => node.tag));
                        const built = descendants(root).filter((candidate) => set.has(typeName(candidate)));
                        const subject = built[nodes.findIndex(({ path }) => path === expectation.path)]!;
                        expect(typeName(subject)).toBe(expectation.gtype);

                        expect(read(expectation, subject)).toBe(expectation.expected);
                    });
                }

                const declared = SHARED_TREE_BLOCKS_WITHOUT_EXPECTATIONS[widget] !== undefined;
                if (expectations.length === 0) {
                    // ADR 0051 § 4: a block that proves nothing has to SAY so, or the pass
                    // count above reads as coverage this corpus does not have.
                    await it(`${widget} reaches no vector, and says why`, () => {
                        expect(declared).toBe(true);
                    });
                } else if (declared) {
                    // Self-retiring, the shape arm 11 already uses for a converged
                    // divergence: a declaration that has stopped being true fails.
                    await it(`${widget} is declared vector-free, and is not`, () => {
                        expect(expectations.map((one) => one.table)).toStrictEqual([]);
                    });
                }
            }
        });

        await it('every table the tree driver claims is one the corpus reaches', () => {
            // The counterweight to `SHARED_TREE_TABLES`, which
            // `check-adwaita-conformance-drivers.mjs` reads as this driver's coverage. A
            // table listed there and reached by no corpus node would be a coverage claim
            // with nothing behind it — the exact class that gate's three incidents are.
            expect(reachedTables(ADWAITA_GALLERY_SHARED_TREES.map((tree) => tree.root))).toStrictEqual([
                ...SHARED_TREE_TABLES,
            ]);
        });
    });
};
