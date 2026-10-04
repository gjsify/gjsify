// The renderer-free half of ADR 0093: what counts as a use, what the pre-check refuses, and
// that the shared vectors cover the vocabulary. A renderer's own claim is driven in its own
// suite through `driveConstructVectors`.

import { describe, expect, it } from '@gjsify/unit';

import {
    CONSTRUCT_KINDS,
    CONSTRUCT_VECTORS,
    UnsupportedConstructError,
    assertTreeConstructs,
    constructUsesOf,
    type ConstructCapabilities,
} from './conformance/constructs.js';

const refusing = (kind: (typeof CONSTRUCT_KINDS)[number]): ConstructCapabilities =>
    ({
        ...Object.fromEntries(CONSTRUCT_KINDS.map((each) => [each, 'implemented' as const])),
        [kind]: { refused: `no door for ${kind}` },
    }) as ConstructCapabilities;

export default async () => {
    await describe('template constructs (ADR 0093)', async () => {
        await it('has a vector for every kind, and a vector only for a kind', () => {
            expect([...new Set(CONSTRUCT_VECTORS.map((vector) => vector.kind))].sort()).toStrictEqual(
                [...CONSTRUCT_KINDS].sort(),
            );
        });

        await it('reads every vector tree as a use of its own kind', () => {
            for (const vector of CONSTRUCT_VECTORS) {
                expect(constructUsesOf(vector.tree).some((use) => use.kind === vector.kind)).toBe(true);
            }
        });

        await it('addresses a use by the pre-order path of its node', () => {
            const grid = CONSTRUCT_VECTORS.find((vector) => vector.kind === 'layout')!;
            expect(constructUsesOf(grid.tree).map((use) => use.path)).toStrictEqual([
                'GtkGrid > GtkLabel[0]',
                'GtkGrid > GtkLabel[1]',
            ]);
        });

        await it('passes a tree that uses no refused construct', () => {
            const vector = CONSTRUCT_VECTORS.find((each) => each.kind === 'layout')!;
            assertTreeConstructs('test', refusing('page'), vector.tree);
            assertTreeConstructs('test', refusing('layout'), { tag: 'GtkBox' });
        });

        await it('refuses a refused construct by kind, node and reason, before anything is built', () => {
            const vector = CONSTRUCT_VECTORS.find((each) => each.kind === 'layout')!;
            let thrown: unknown;
            try {
                assertTreeConstructs('adwaita-web', refusing('layout'), vector.tree);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof UnsupportedConstructError).toBe(true);
            const message = (thrown as Error).message;
            expect(message.includes('adwaita-web')).toBe(true);
            expect(message.includes('layout at GtkGrid > GtkLabel[0] — no door for layout')).toBe(true);
        });

        await it('fails a table that has no row for a kind the tree uses', () => {
            const vector = CONSTRUCT_VECTORS.find((each) => each.kind === 'page')!;
            expect(() => assertTreeConstructs('x', {} as ConstructCapabilities, vector.tree)).toThrow(
                "no row for the construct 'page'",
            );
        });
    });
};
