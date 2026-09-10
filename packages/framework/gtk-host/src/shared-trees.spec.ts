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
// EVERYTHING THAT IS NOT ABOUT THIS RENDERER IS ELSEWHERE. Which tables the corpus reaches,
// which block is declared to reach none, and whether an expectation's address exists at all
// are facts about the CORPUS: they are asserted once, in `adwaita-core`'s own suite, which
// runs on Node as well. Asserting them here too would be the same claim in three places,
// two of which need a display.
//
// THE READERS GO THROUGH THE REAL GTK TREE (`descendants`, `findDescendant`), never the
// host's shadow links: a renderer asserting against its own bookkeeping agrees with itself
// while the window is wrong.

import { expect, it, on } from '@gjsify/unit';

import type Adw from '@girs/adw-1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    authoredTags,
    sharedTreeExpectations,
    subjectIndexOf,
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
    // Before the children: `insert` parents a REALISED widget, and a construct-only
    // property that never arrives reaches `g_error()` rather than failing a test.
    materialize(el);
    for (const child of node.children ?? []) insert(build(child), el);
    return el;
}

/** `build` has materialised every node on the way down, so the widget is already there. */
const widgetOf = (el: HostElement) => el.widget as unknown as Gtk.Widget;
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

        const blocks = ADWAITA_GALLERY_SHARED_TREES.map((tree) => ({
            widget: tree.widget,
            // `gtkHostTree` has already turned the tags into this renderer's spelling; the
            // AUTHORED tree keeps the GIR names, which is what the walks below compare
            // against because they read GTypes off the real tree.
            host: gtkHostTree(tree.widget).root,
            authored: tree.root,
        }));

        /**
         * Depth-first over the real tree, filtered to the authored classes: the libadwaita
         * internals between them (a revealer, a listbox, a gizmo) are not the renderer's
         * promise, the ORDER and the NESTING of what was authored is. Exact type names, so a
         * subclass cannot stand in.
         */
        const realised = (root: Gtk.Widget, wanted: readonly string[]) => {
            const set = new Set(wanted);
            return descendants(root).filter((candidate) => set.has(typeName(candidate)));
        };

        await gated(diagnostics, 'the shared corpus builds through gtk-host', async () => {
            for (const block of blocks) {
                await it(`${block.widget} builds, and the REAL tree carries the authored nodes in order`, () => {
                    const root = widgetOf(build(block.host));
                    const wanted = authoredTags(block.authored);

                    expect(realised(root, wanted).map(typeName)).toStrictEqual(wanted);
                });
            }
        });

        await gated(diagnostics, 'the shared corpus against the adwaita-core vectors it reaches', async () => {
            for (const block of blocks) {
                for (const expectation of sharedTreeExpectations(block.authored)) {
                    await it(`${block.widget} — ${expectation.path}: ${expectation.table} — ${expectation.rule}`, () => {
                        const root = widgetOf(build(block.host));
                        // The SAME filtered walk the shape test asserts, so the widget an
                        // expectation is read off is the one at the authored ADDRESS rather
                        // than the first of its class the tree happens to contain.
                        const built = realised(root, authoredTags(block.authored));
                        const subject = built[subjectIndexOf(block.authored, expectation.path)]!;
                        expect(typeName(subject)).toBe(expectation.gtype);

                        expect(read(expectation, subject)).toBe(expectation.expected);
                    });
                }
            }
        });
    });
};
