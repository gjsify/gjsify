// EVERY GALLERY `.blp` BUILDS HERE, and every id in it is reachable.
//
// A one-Blueprint gallery block (`website/src/blueprints/`) shows a NativeScript tab that
// calls `build()` on the file's `?shared-tree` projection and reaches views with
// `getViewById`. The website builds only the web projection, so nothing ran that pane: a
// header bar whose `title-widget:` slot this port did not spell, or a menu button with no
// style-class door, would have shipped a snippet that throws on its first line.
//
// The trees come from the Blueprint corpus's hand-written expectations, which
// `check-blueprint-corpus.mjs` holds equal to what `projectToSharedNode` produces from each
// file, and which that gate requires for every tracked `.blp`. Reading them here, rather
// than importing `?shared-tree`, keeps this entry buildable without the Blueprint plugin.
//
// Lives on the TREES entry: it builds real widget classes, which need the double.

import { describe, expect, it } from '@gjsify/unit';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { REAL_EXPECTATIONS } from '../../../infra/blueprint/corpus/real-expectations.mjs';

import { build } from './builder/index.js';

const GALLERY = 'website/src/blueprints/';

/** Every id the tree authors, depth first. */
function idsOf(node: SharedTreeNode, into: string[] = []): string[] {
    if (node.id !== undefined) into.push(node.id);
    for (const child of node.children ?? []) idsOf(child, into);
    return into;
}

export const AdwGalleryBlueprintsNsTest = async () => {
    const trees = (REAL_EXPECTATIONS as ReadonlyArray<{ file: string; node: SharedTreeNode }>).filter((entry) =>
        entry.file.startsWith(GALLERY),
    );

    await describe('the gallery Blueprints build on NativeScript', async () => {
        // Otherwise the loop below is green from emptiness.
        await it('the corpus holds gallery Blueprints at all', () => {
            expect(trees.length > 0).toBe(true);
        });

        for (const { file, node } of trees) {
            await it(`${file} builds, and getViewById reaches every id it names`, () => {
                const root = build(node) as unknown as { getViewById(id: string): object | undefined };
                for (const id of idsOf(node)) expect(root.getViewById(id) !== undefined).toBe(true);
            });
        }
    });

    // Accepting a name is not placing by it: a builder routing `end` to `pack_start` would
    // pass every test above. So the header bar is held to where GTK puts each child, and the
    // menu button to the class its `styles ["flat"]` asks for.
    await describe('the gallery header bar builds as GTK places it', async () => {
        const entry = trees.find(({ file }) => file.endsWith('/header-bar.blp'));
        if (entry === undefined) throw new Error('the corpus has no gallery header-bar.blp');

        type Probe = {
            getViewById(id: string): Probe | undefined;
            parent: Probe | null;
            titleWidget?: Probe;
            startBox?: Probe;
            endBox?: Probe;
            className?: string;
            has_css_class?(name: string): boolean;
            add_css_class?(name: string): void;
        };
        const root = build(entry.node) as unknown as Probe;
        const byId = (id: string) => root.getViewById(id)!;

        await it('title-widget: becomes the title widget', () => {
            expect(root.titleWidget === byId('window_title')).toBe(true);
        });

        await it('[start] lands in the start box', () => {
            expect(byId('back_button').parent === root.startBox).toBe(true);
        });

        await it('[end] lands in the end box', () => {
            expect(byId('menu_button').parent === root.endBox).toBe(true);
        });

        await it('styles ["flat"] reaches the menu button as the flat class', () => {
            const menu = byId('menu_button');
            expect(menu.has_css_class?.('flat')).toBe(true);
            expect((menu.className ?? '').split(' ').includes('flat')).toBe(true);
            menu.add_css_class?.('circular');
            expect((menu.className ?? '').split(' ').includes('circular')).toBe(true);
        });
    });

    // Building is not placing, as above. The button-content file puts an `Adw.ButtonContent`
    // in a `Gtk.Button`'s `child:` property, and the button-row file styles its row; both
    // were refused by the builder until the widgets declared those doors, and a door that
    // accepted the name but dropped the value would still pass the loop at the top.
    await describe('the gallery buttons build as GTK places them', async () => {
        const byFile = (name: string) => {
            const entry = trees.find(({ file }) => file.endsWith(name));
            if (entry === undefined) throw new Error(`the corpus has no gallery ${name}`);
            return build(entry.node) as unknown as {
                getViewById(id: string): { className?: string } | undefined;
                child?: object | null;
                has_css_class?(name: string): boolean;
                className?: string;
            };
        };

        await it("child: becomes the button's child", () => {
            const button = byFile('/button-content.blp');
            expect(button.child === button.getViewById('content')).toBe(true);
        });

        await it('styles ["suggested-action"] reaches the button row as a class', () => {
            const row = byFile('/button-row.blp').getViewById('row') as {
                has_css_class(name: string): boolean;
                className?: string;
            };
            expect(row.has_css_class('suggested-action')).toBe(true);
            const classes = (row.className ?? '').split(' ');
            expect(classes.includes('suggested-action') && classes.includes('adw-button-row')).toBe(true);
        });
    });
};
