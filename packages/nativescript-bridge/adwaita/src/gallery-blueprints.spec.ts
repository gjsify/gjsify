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
};
