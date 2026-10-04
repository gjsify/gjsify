// Which template constructs a renderer builds, and the tests that hold the claim — ADR 0093.
//
// A construct is something an authored tree can carry that a renderer may not be able to
// build: `layout` (ADR 0092), a string list or a dialog's responses (ADR 0072), a notebook or
// stack `page`. Each renderer package exports a pure-data `./capabilities` table that answers
// for every kind, and this module is what makes the answer checkable from both sides:
//
//   · {@link assertTreeConstructs} is the builder pre-check. It runs before a builder creates
//     anything, so a refusal never leaves a half-built tree, and it names the construct and the
//     node.
//   · {@link driveConstructVectors} is the claim test. A kind declared `implemented` needs a
//     vector whose observable holds in the realised tree; a kind declared `{ refused }` is built
//     through the real builder and must throw naming the kind. A renderer that gains a door and
//     forgets to flip its row fails the control, so a refusal retires itself.
//
// THE LIST IS OPEN (ADR 0093 § 6). A new construct is one kind here, one row per renderer, one
// vector, and its restatement in `scripts/check-shared-tree-shape.mjs`; the total table is what
// makes a missing row fail instead of arriving unclaimed.

import type { SharedTreeNode } from './shared-trees.js';
import { authoredNodes } from './shared-trees.js';

/** The construct kinds, in the order the tables list them. */
export const CONSTRUCT_KINDS = ['layout', 'strings', 'responses', 'page', 'extern'] as const;

export type ConstructKind = (typeof CONSTRUCT_KINDS)[number];

/** `implemented`, or the sentence a human can act on — it is the text the error prints. */
export type ConstructCapability = 'implemented' | { readonly refused: string };

/** A renderer's `./capabilities` export: TOTAL over {@link ConstructKind}. */
export type ConstructCapabilities = Readonly<Record<ConstructKind, ConstructCapability>>;

/** One occurrence of a construct in a tree, addressed the way a failure has to name it. */
export interface ConstructUse {
    kind: ConstructKind;
    /** The pre-order address `authoredNodes` gives the node. */
    path: string;
}

/** Every construct `root` uses, in pre-order. */
export function constructUsesOf(root: SharedTreeNode): ConstructUse[] {
    const found: ConstructUse[] = [];
    for (const { node, path } of authoredNodes(root)) {
        if (node.layout !== undefined) found.push({ kind: 'layout', path });
        if (node.extensions?.strings !== undefined) found.push({ kind: 'strings', path });
        if (node.extensions?.responses !== undefined) found.push({ kind: 'responses', path });
        if (node.page !== undefined) found.push({ kind: 'page', path });
        if (node.extern === true) found.push({ kind: 'extern', path });
    }
    return found;
}

/** A tree uses a construct the renderer it was handed to refuses. */
export class UnsupportedConstructError extends Error {
    readonly renderer: string;
    readonly refused: readonly { kind: ConstructKind; path: string; reason: string }[];

    constructor(renderer: string, refused: readonly { kind: ConstructKind; path: string; reason: string }[]) {
        const listed = refused.map((use) => `  ${use.kind} at ${use.path} — ${use.reason}`).join('\n');
        super(`this tree cannot be rendered by ${renderer}: ${refused.length} construct(s) it refuses.\n${listed}`);
        this.name = 'UnsupportedConstructError';
        this.renderer = renderer;
        this.refused = refused;
    }
}

/**
 * The builder pre-check: throws {@link UnsupportedConstructError} for every construct of `root`
 * that `capabilities` refuses, before the caller creates anything.
 *
 * A table that lacks a kind this tree uses is a defect of the table and says so rather than
 * reading as permission.
 */
export function assertTreeConstructs(
    renderer: string,
    capabilities: ConstructCapabilities,
    root: SharedTreeNode,
): void {
    const refused: { kind: ConstructKind; path: string; reason: string }[] = [];
    for (const use of constructUsesOf(root)) {
        const capability = capabilities[use.kind] as ConstructCapability | undefined;
        if (capability === undefined) {
            throw new Error(`${renderer}'s capabilities declare no row for the construct '${use.kind}'.`);
        }
        if (capability !== 'implemented') refused.push({ ...use, reason: capability.refused });
    }
    if (refused.length > 0) throw new UnsupportedConstructError(renderer, refused);
}

/**
 * One construct, as an authored tree and what a renderer that builds it must show.
 *
 * `shows` is renderer-free data; each renderer's `read` turns its realised tree into the same
 * shape, so a failure is attributable to the renderer and not to two suites disagreeing.
 */
export interface ConstructVector {
    readonly kind: ConstructKind;
    readonly rule: string;
    readonly tree: SharedTreeNode;
    readonly shows: unknown;
}

export const CONSTRUCT_VECTORS: readonly ConstructVector[] = [
    {
        kind: 'layout',
        rule: '`layout { }` places a grid child in its cell (ADR 0092); the spans default to one',
        tree: {
            tag: 'GtkGrid',
            children: [
                { tag: 'GtkLabel', id: 'a', layout: { row: 0, column: 0 } },
                { tag: 'GtkLabel', id: 'b', layout: { row: 1, column: 1, 'column-span': 2 } },
            ],
        },
        shows: [
            { row: 0, column: 0, columnSpan: 1 },
            { row: 1, column: 1, columnSpan: 2 },
        ],
    },
    {
        kind: 'strings',
        rule: '`strings [ ]` fills a combo row model in source order (ADR 0072)',
        tree: {
            tag: 'AdwComboRow',
            props: { title: 'Colour' },
            children: [
                {
                    tag: 'GtkStringList',
                    slot: 'model',
                    extensions: { strings: [{ value: 'Blue' }, { value: 'Teal' }, { value: 'Green' }] },
                },
            ],
        },
        shows: ['Blue', 'Teal', 'Green'],
    },
    {
        kind: 'responses',
        rule: '`responses [ ]` registers each response with its appearance and enabled state (ADR 0072)',
        tree: {
            tag: 'AdwAlertDialog',
            props: { heading: 'Delete?' },
            extensions: {
                responses: [
                    { id: 'cancel', label: 'Cancel' },
                    { id: 'delete', label: 'Delete', appearance: 'destructive', enabled: false },
                ],
            },
        },
        shows: [
            { id: 'cancel', label: 'Cancel', appearance: 'default', enabled: true },
            { id: 'delete', label: 'Delete', appearance: 'destructive', enabled: false },
        ],
    },
    {
        kind: 'page',
        rule: 'a stack child with a `page` is a page with that name and title',
        tree: {
            tag: 'GtkStack',
            children: [{ tag: 'GtkLabel', props: { label: 'x' }, page: { name: 'first', label: 'First' } }],
        },
        shows: [{ name: 'first', title: 'First' }],
    },
    {
        kind: 'extern',
        rule: 'an `extern` node is built by the class the application registered under its name (ADR 0093)',
        tree: {
            tag: 'GtkBox',
            children: [{ tag: 'CorpusExtern', id: 'registered', extern: true }],
        },
        shows: [{ id: 'registered', builtByRegisteredClass: true }],
    },
];

/** The name the extern vector's class is registered under, so each renderer registers the same one. */
export const EXTERN_VECTOR_CLASS = 'CorpusExtern';

/** What a renderer hands {@link driveConstructVectors}. */
export interface ConstructRenderer {
    /** The package name, as an error prints it. */
    readonly name: string;
    readonly capabilities: ConstructCapabilities;
    /** The vectors it is held to — passed in so the renderer's own suite names the table it drives. */
    readonly vectors: readonly ConstructVector[];
    /** Builds `tree` through the renderer's REAL builder, reads it, and tears it down. */
    observe(vector: ConstructVector): unknown;
}

/** The slice of `@gjsify/unit` this driver uses; the package cannot import it at run time. */
export interface ConstructHarness {
    describe(name: string, fn: () => void | Promise<void>): void | Promise<void>;
    it(name: string, fn: () => void | Promise<void>): void | Promise<void>;
    expect(actual: unknown): { toBe(expected: unknown): void };
}

/**
 * Holds a renderer's capability table to the vectors, in both directions, and fails a table
 * that lacks a kind.
 */
export async function driveConstructVectors(renderer: ConstructRenderer, harness: ConstructHarness): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${renderer.name}: template constructs (ADR 0093)`, async () => {
        await it('declares a row for every construct kind, and no other', () => {
            expect(Object.keys(renderer.capabilities).sort().join()).toBe([...CONSTRUCT_KINDS].sort().join());
        });
        for (const kind of CONSTRUCT_KINDS) {
            const capability = renderer.capabilities[kind];
            const vectors = renderer.vectors.filter((vector) => vector.kind === kind);
            if (capability === 'implemented') {
                await it(`${kind}: a claim has at least one vector`, () => {
                    expect(vectors.length > 0).toBe(true);
                });
                for (const vector of vectors) {
                    await it(`${kind} is built: ${vector.rule}`, () => {
                        // JSON because the harness only needs `toBe`, and `shows` is plain data.
                        expect(JSON.stringify(renderer.observe(vector))).toBe(JSON.stringify(vector.shows));
                    });
                }
                continue;
            }
            for (const vector of vectors) {
                await it(`${kind} is refused by name: ${vector.rule}`, () => {
                    let thrown: unknown;
                    try {
                        renderer.observe(vector);
                    } catch (error) {
                        thrown = error;
                    }
                    // The refusal, not any error: a renderer that fails on an unknown tag has not
                    // said anything about this construct.
                    expect(thrown instanceof UnsupportedConstructError).toBe(true);
                    expect(
                        thrown instanceof UnsupportedConstructError && thrown.refused.some((use) => use.kind === kind),
                    ).toBe(true);
                });
            }
        }
    });
}
