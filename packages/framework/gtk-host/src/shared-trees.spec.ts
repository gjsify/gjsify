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
    sharedTreePlacements,
    subjectIndexOf,
    withoutPlacements,
    type SharedTreeExpectation,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';

import { ADWAITA_GALLERY_SHARED_TREES, gtkHostTree } from '../../../../scripts/adwaita-gallery-shared-trees.mjs';
// `buildSharedTree` is SHIPPED code, not this driver's own — it is the renderer-specific
// half of ADR 0051 that any consumer of this package may need, so it lives in
// `./conformance/shared-tree-builder.ts` rather than here. Its header carries the
// `registerBuiltinWidgets()` precondition this suite already satisfies two lines down.
import { buildSharedTree, descendants, findDescendant, installDiagnosticsGate } from './conformance/index.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import type { HostElement } from './types.js';

/** `buildSharedTree` has materialised every node on the way down, so the widget is already there. */
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
         * Build a block, and read back the real tree filtered to the widgets THIS BUILD made.
         *
         * Depth-first over the real tree: the libadwaita internals between the authored nodes
         * (a revealer, a listbox, a gizmo) are not the renderer's promise, the ORDER and the
         * NESTING of what was authored is.
         *
         * BY IDENTITY, NOT BY CLASS NAME, and that changed when the corpus first authored a
         * `GtkButton`: `AdwEntryRow`'s own apply button is a `GtkButton` too, so a name filter
         * read one node too many and the order assertion failed on a tree that was right. The
         * builder hands back what it created, which is the only answer that stays true however
         * far the corpus grows into libadwaita's own vocabulary.
         */
        const build = (block: { host: SharedTreeNode }) => {
            const built: HostElement[] = [];
            const root = widgetOf(buildSharedTree(block.host, built));
            const ours = new Set(built.map(widgetOf));
            return { root, realised: descendants(root).filter((candidate) => ours.has(candidate)) };
        };

        await gated(diagnostics, 'the shared corpus builds through gtk-host', async () => {
            for (const block of blocks) {
                await it(`${block.widget} builds, and the REAL tree carries the authored nodes in order`, () => {
                    expect(build(block).realised.map(typeName)).toStrictEqual(authoredTags(block.authored));
                });
            }
        });

        /**
         * The realised tree as NESTING AND TYPE ONLY — no property, no attribute, and in
         * particular nothing derived from the authored slot itself.
         *
         * That exclusion is what makes the comparison below mean something: an `adw-*` tree
         * carrying its own `slot=` would differ between the two builds on the attribute
         * alone, and the arm would pass while the widget sat in the wrong container.
         */
        const structure = (widget: Gtk.Widget): string => {
            const children: string[] = [];
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
                children.push(structure(child));
            }
            return `${typeName(widget)}[${children.join(',')}]`;
        };

        await gated(diagnostics, 'the shared corpus is placed where it says', async () => {
            // A CONTROL, not a table of where each slot lands. `withoutPlacements` is the
            // tree a builder that never read `slot` hands this renderer — which is what all
            // three builders did — so the two realised trees being IDENTICAL is exactly that
            // regression, and no per-widget knowledge enters the driver to catch it. What it
            // proves is narrow on purpose: the placement was HONOURED, not that libadwaita
            // put it where libadwaita should.
            for (const block of blocks) {
                const placements = sharedTreePlacements(block.authored);
                if (placements.length === 0) continue;
                const named = placements.map(({ path, slot }) => `${path} -> ${slot}`).join(', ');
                await it(`${block.widget} — ${named}: the built tree is not the unplaced one`, () => {
                    const placed = structure(build(block).root);
                    const unplaced = structure(build({ host: withoutPlacements(block.host) }).root);

                    expect(placed === unplaced).toBe(false);
                });
            }

            // Otherwise the loop above is green from emptiness, which is the one way this
            // arm can lie: the corpus authored no slot at all until a `.blp` forced the
            // question, and a suite that says nothing about its own denominator would have
            // read the same either way.
            await it('the corpus authors a placement at all', () => {
                expect(blocks.some((block) => sharedTreePlacements(block.authored).length > 0)).toBe(true);
            });

            // THE OTHER HALF OF READING A SLOT, and the corpus cannot carry it: a name this
            // renderer has no destination for. Authored here rather than admitted to the
            // shared source, because a tree no renderer can build is not a shared tree.
            await it('a slot the parent has no destination for is refused BY NAME', () => {
                expect(() =>
                    buildSharedTree({
                        tag: 'adw-expander-row',
                        children: [{ tag: 'gtk-button', slot: 'middle' }],
                    }),
                ).toThrow('has no slot "middle"');
            });

            await it('a slot on a parent with no slots at all is refused too', () => {
                // `AdwPreferencesGroup` is `ordered`, so this used to be read as no slot at
                // all and the row landed in the list — the silent half of the same defect.
                expect(() =>
                    buildSharedTree({
                        tag: 'adw-preferences-group',
                        children: [{ tag: 'adw-entry-row', slot: 'header-suffix' }],
                    }),
                ).toThrow('has no slot "header-suffix"');
            });

            await it('the PROPERTY spelling of a slot reaches the same widget as its bracket', () => {
                // `[title]` and `title-widget:` are one placement written two ways, and GTK
                // accepts both: the buildable branch calls the setter. A `.blp` authoring the
                // second carried a name the descriptor's key alone would have refused.
                const bar = widgetOf(
                    buildSharedTree({
                        tag: 'adw-header-bar',
                        children: [{ tag: 'adw-window-title', slot: 'title-widget', props: { title: 'Placed' } }],
                    }),
                ) as unknown as Adw.HeaderBar;
                const title = bar.get_title_widget();

                expect(title === null ? 'nothing at all' : typeName(title as unknown as Gtk.Widget)).toBe(
                    'AdwWindowTitle',
                );
            });
        });

        await gated(diagnostics, 'the shared corpus against the adwaita-core vectors it reaches', async () => {
            for (const block of blocks) {
                for (const expectation of sharedTreeExpectations(block.authored)) {
                    await it(`${block.widget} — ${expectation.path}: ${expectation.table} — ${expectation.rule}`, () => {
                        // The SAME filtered walk the shape test asserts, so the widget an
                        // expectation is read off is the one at the authored ADDRESS rather
                        // than the first of its class the tree happens to contain.
                        const subject = build(block).realised[subjectIndexOf(block.authored, expectation.path)]!;
                        expect(typeName(subject)).toBe(expectation.gtype);

                        expect(read(expectation, subject)).toBe(expectation.expected);
                    });
                }
            }
        });
    });
};
