// The renderer-free half of ADR 0051's suite, on a runtime with no renderer at all.
//
// WHY IT EXISTS RATHER THAN LIVING IN THE DRIVERS. The two tree drivers run one per renderer
// and one per runtime — `gtk-host` under GJS, `adwaita-web` under Firefox — so a rule they
// each assert is a rule asserted twice, and neither leg runs on Node. Everything here is
// about the CORPUS and the LEDGER rather than about a widget, so it belongs where both legs
// can inherit it and where the Node run proves the join itself is right (tests/AGENTS.md
// rule 3: Node proves the test, the renderer legs prove the implementations).
//
// It reads `scripts/adwaita-gallery-shared-trees.mjs` — the corpus itself, the same file the
// two gallery generators emit from and the two drivers build.

import { describe, expect, it } from '@gjsify/unit';

import { ADWAITA_GALLERY_SHARED_TREES } from '../../../../scripts/adwaita-gallery-shared-trees.mjs';
import {
    SHARED_TREE_BLOCKS_WITHOUT_EXPECTATIONS,
    SHARED_TREE_TABLES,
    authoredNodes,
    reachedTables,
    sharedTreeExpectations,
} from './conformance/shared-trees.js';

export default async () => {
    await describe('the shared authored corpus, joined to the vectors', async () => {
        await it('reaches exactly the tables the join claims', () => {
            // `SHARED_TREE_TABLES` is what `check-adwaita-conformance-drivers.mjs` credits a
            // renderer with. The gate can see that the file IMPORTS each of them; only a run
            // can see whether an authored node instantiates a row, so that half is here.
            expect(reachedTables(ADWAITA_GALLERY_SHARED_TREES.map((block) => block.root))).toStrictEqual([
                ...SHARED_TREE_TABLES,
            ]);
        });

        await it('addresses every expectation to a node the tree actually has', () => {
            // Both drivers locate their subject by matching this `path` against the same
            // pre-order walk. An address the walk does not produce would pick the wrong
            // widget — or `undefined`, which reads as a renderer bug rather than a join bug.
            for (const block of ADWAITA_GALLERY_SHARED_TREES) {
                const addresses = new Set(authoredNodes(block.root).map(({ path }) => path));
                for (const expectation of sharedTreeExpectations(block.root)) {
                    expect(addresses.has(expectation.path)).toBe(true);
                }
            }
        });

        await it('gives every node address exactly once, so an index is a subject', () => {
            for (const block of ADWAITA_GALLERY_SHARED_TREES) {
                const paths = authoredNodes(block.root).map(({ path }) => path);
                expect(new Set(paths).size).toBe(paths.length);
            }
        });

        await it('declares a block that reaches nothing, and only such a block', () => {
            // ADR 0051 § 4, both directions. The second is the self-retiring half: a
            // declaration that has stopped being true fails, the shape arm 11 of
            // `check-generated-website-data.mjs` already uses for a converged divergence.
            for (const block of ADWAITA_GALLERY_SHARED_TREES) {
                const reaches = sharedTreeExpectations(block.root).length > 0;
                const declared = SHARED_TREE_BLOCKS_WITHOUT_EXPECTATIONS[block.widget] !== undefined;
                expect(`${block.widget}: reaches=${reaches} declared=${declared}`).toBe(
                    `${block.widget}: reaches=${reaches} declared=${!reaches}`,
                );
            }
        });

        await it('declares nothing that is not a block of the corpus', () => {
            // A declaration for a block that has left the shared source explains a silence
            // nobody is keeping, and it would go on reading as coverage-with-a-reason.
            const blocks = new Set(ADWAITA_GALLERY_SHARED_TREES.map((block) => block.widget));
            for (const widget of Object.keys(SHARED_TREE_BLOCKS_WITHOUT_EXPECTATIONS)) {
                expect(`${widget} is in the corpus: ${blocks.has(widget)}`).toBe(`${widget} is in the corpus: true`);
            }
        });

        await it('carries the row’s own rule, which is what a failure names', () => {
            // The drivers put `rule` in the test title. An empty one turns an attributable
            // failure into "something about a banner", which is the whole reason the vector
            // tables carry the field.
            for (const block of ADWAITA_GALLERY_SHARED_TREES) {
                for (const expectation of sharedTreeExpectations(block.root)) {
                    expect(expectation.rule.length > 0).toBe(true);
                    expect(expectation.table.endsWith('_VECTORS')).toBe(true);
                }
            }
        });
    });
};
