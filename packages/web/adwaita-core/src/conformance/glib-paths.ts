// `GLib.MAXUINT32`, `build_filenamev`, `get_current_dir`, `get_system_data_dirs` as observable
// behaviour. The SAME vectors run on real `gi://GLib` (the ORACLE), on the core and on each port's
// `GLib` door. `get_current_dir` and `get_system_data_dirs` are the host's to answer, so the shared
// rows hold only their shape; each port's spec holds the value it chose.

import type { ConstructHarness } from './constructs.js';

/** The part of `GLib` the vectors read. */
export interface GLibPathsLike {
    readonly MAXUINT32: number;
    build_filenamev(elements: string[]): string;
    get_current_dir(): string;
    get_system_data_dirs(): string[];
}

export interface GLibPathsSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly GLib: GLibPathsLike;
}

export const GLIB_PATH_ROWS = ['constant', 'join', 'separators', 'empty', 'shape'] as const;

export type GLibPathRow = (typeof GLIB_PATH_ROWS)[number];

export interface GLibPathVector {
    readonly row: GLibPathRow;
    readonly rule: string;
    readonly observe: (subject: GLibPathsSubject) => unknown;
    readonly shows: unknown;
}

const build =
    (...cases: string[][]) =>
    (subject: GLibPathsSubject) =>
        cases.map((elements) => subject.GLib.build_filenamev(elements));

export const GLIB_PATH_VECTORS: readonly GLibPathVector[] = [
    {
        row: 'constant',
        rule: 'MAXUINT32 is G_MAXUINT32 as a number',
        observe: ({ GLib }) => GLib.MAXUINT32,
        shows: 4294967295,
    },
    {
        row: 'join',
        rule: 'elements are joined by exactly one separator',
        observe: build(['a', 'b'], ['a/', '/b'], ['a', 'b', 'c'], ['a/', 'b/']),
        shows: ['a/b', 'a/b', 'a/b/c', 'a/b/'],
    },
    {
        row: 'separators',
        rule: 'leading and trailing separators of the ends are kept, inner runs and dots are not normalised',
        observe: build(
            ['/a', 'b/'],
            ['a', 'b', '/'],
            ['/', 'a'],
            ['//a', 'b'],
            ['a//b', 'c'],
            ['a/./b', 'c'],
            ['a/..', 'b'],
        ),
        shows: ['/a/b/', 'a/b/', '/a', '//a/b', 'a//b/c', 'a/./b/c', 'a/../b'],
    },
    {
        row: 'empty',
        rule: 'empty elements are skipped; no element is the empty string; a lone element stays',
        observe: build(['', 'a'], ['a', ''], [], ['a'], ['/']),
        shows: ['a', 'a', '', 'a', '/'],
    },
    {
        row: 'shape',
        rule: 'the working directory is an absolute string, the system data dirs an array of absolute strings',
        observe: ({ GLib }) => [
            typeof GLib.get_current_dir() === 'string' && GLib.get_current_dir().startsWith('/'),
            Array.isArray(GLib.get_system_data_dirs()) &&
                GLib.get_system_data_dirs().every((dir) => typeof dir === 'string' && dir.startsWith('/')),
        ],
        shows: [true, true],
    },
];

export async function driveGLibPathVectors(
    subject: GLibPathsSubject,
    harness: ConstructHarness,
    vectors: readonly GLibPathVector[] = GLIB_PATH_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GLib paths`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
