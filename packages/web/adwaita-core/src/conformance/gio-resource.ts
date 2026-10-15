// The `Gio.Resource` subset of ADR 0116 § 3 as observable behaviour, over bytes `glib-compile-resources`
// wrote (`fixtures/gio-resource/`). The SAME vectors run on real `gi://Gio` (the ORACLE) and on the core.
// What the subset REFUSES (`open_stream`, `Resource.load`, a compressed `lookup_data`, a byte-swapped
// file) is not here: GIO answers all four, so those are asserted in the core's own spec.

import { FIXTURE_GRESOURCE_BASE64, OVERLAY_GRESOURCE_BASE64 } from '../gio-resource.fixtures.js';
import type { ConstructHarness } from './constructs.js';

export interface GioResourceLike {
    lookup_data(path: string, lookup_flags: number): { get_data(): Uint8Array };
    get_info(path: string, lookup_flags: number): [boolean, number, number];
    enumerate_children(path: string, lookup_flags: number): string[];
    _register(): void;
    _unregister(): void;
}

/** The part of `Gio` the vectors read. `bytes` makes what `new_from_data` takes (a `GLib.Bytes`). */
export interface GioResourceNamespace {
    readonly Resource: { new_from_data(data: unknown): GioResourceLike };
    readonly ResourceLookupFlags: { readonly NONE: number };
    readonly ResourceError: object;
    resources_register(resource: GioResourceLike): void;
    resources_unregister(resource: GioResourceLike): void;
    resources_lookup_data(path: string, lookup_flags: number): { get_data(): Uint8Array };
    resources_get_info(path: string, lookup_flags: number): [boolean, number, number];
    resources_enumerate_children(path: string, lookup_flags: number): string[];
}

export interface GioResourceSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Gio: GioResourceNamespace;
    readonly bytes: (data: Uint8Array) => unknown;
}

export const GIO_RESOURCE_ROWS = [
    'create',
    'lenient-root',
    'lookup',
    'info',
    'enumerate',
    'not-found',
    'registry',
    'aggregate',
] as const;

export type GioResourceRow = (typeof GIO_RESOURCE_ROWS)[number];

export interface GioResourceVector {
    readonly row: GioResourceRow;
    readonly rule: string;
    readonly observe: (subject: GioResourceSubject) => unknown;
    readonly shows: unknown;
}

function decodeBase64(text: string): Uint8Array {
    const binary = atob(text);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The bytes of `fixtures/gio-resource/{fixture,overlay}.gresource`. */
export function gioResourceFixtures(): { fixture: Uint8Array; overlay: Uint8Array } {
    return { fixture: decodeBase64(FIXTURE_GRESOURCE_BASE64), overlay: decodeBase64(OVERLAY_GRESOURCE_BASE64) };
}

const ERROR_NAMES: Record<number, string> = { 0: 'NOT_FOUND', 1: 'INTERNAL' };

/** `{ ok }` for a value, `{ error }` for a `Gio.ResourceError` (checked with `matches`), `{ thrown }` otherwise. */
function attempt(subject: GioResourceSubject, run: () => unknown): unknown {
    try {
        return { ok: run() };
    } catch (error) {
        const e = error as { code?: number; matches?: (domain: object, code: number) => boolean };
        if (
            typeof e?.matches === 'function' &&
            typeof e.code === 'number' &&
            e.matches(subject.Gio.ResourceError, e.code)
        ) {
            return { error: ERROR_NAMES[e.code] ?? e.code };
        }
        return { thrown: String(error) };
    }
}

const NONE = 0;
const PREFIX = '/org/gjsify/fixture';

const open = (subject: GioResourceSubject, data: Uint8Array = gioResourceFixtures().fixture) =>
    subject.Gio.Resource.new_from_data(subject.bytes(data));

const text = (data: { get_data(): Uint8Array }) => new TextDecoder().decode(data.get_data());

/** Registers `resources` in order, runs `run`, and leaves the registry as it found it. */
function registered<T>(subject: GioResourceSubject, resources: GioResourceLike[], run: () => T): T {
    for (const resource of resources) subject.Gio.resources_register(resource);
    try {
        return run();
    } finally {
        for (const resource of resources) subject.Gio.resources_unregister(resource);
    }
}

/**
 * CORE-ONLY: GAP (#2239) — neither port exposes the subset yet; ADR 0116 step 3 wires it into
 * `Gtk.IconTheme` and `GtkApplication` on the web, then NativeScript. Until then the core suite
 * drives it here and real `gi://Gio` under GJS is the oracle (`gio-resource.gjs.spec.ts`).
 */
export const GIO_RESOURCE_VECTORS: readonly GioResourceVector[] = [
    {
        row: 'create',
        rule: 'GVDB bytes open from a GLib.Bytes or a Uint8Array; anything else is INTERNAL (invalid gvdb header)',
        observe: (subject) => {
            const { fixture } = gioResourceFixtures();
            const badSignature = fixture.slice();
            badSignature[0] ^= 0xff;
            return [
                attempt(subject, () => open(subject) !== null),
                attempt(subject, () => subject.Gio.Resource.new_from_data(fixture.slice()) !== null),
                attempt(subject, () => open(subject, new Uint8Array([1, 2, 3, 4]))),
                attempt(subject, () => open(subject, new Uint8Array(0))),
                attempt(subject, () => open(subject, badSignature)),
            ];
        },
        shows: [{ ok: true }, { ok: true }, { error: 'INTERNAL' }, { error: 'INTERNAL' }, { error: 'INTERNAL' }],
    },
    {
        row: 'lenient-root',
        rule: 'only the header is checked: a root table that does not fit the file opens and finds nothing',
        observe: (subject) => {
            const { fixture } = gioResourceFixtures();
            const empty = new Uint8Array(24);
            empty.set(new TextEncoder().encode('GVariant'));
            return [fixture.slice(0, 100), empty].map((data) =>
                attempt(subject, () => open(subject, data).lookup_data(`${PREFIX}/hello.txt`, NONE)),
            );
        },
        shows: [{ error: 'NOT_FOUND' }, { error: 'NOT_FOUND' }],
    },
    {
        row: 'lookup',
        rule: 'lookup_data returns the file bytes; aliases, empty and binary files, UTF-8 names and stripblanks output hold',
        observe: (subject) => {
            const resource = open(subject);
            const at = (name: string) => resource.lookup_data(`${PREFIX}/${name}`, NONE);
            return [
                text(at('hello.txt')),
                text(at('aliased/greeting.txt')),
                at('empty.txt').get_data().length,
                Array.from(at('blob.bin').get_data()).every((byte, i) => byte === i),
                at('blob.bin').get_data().length,
                text(at('umlaut/größe.txt')),
                text(at('icons/scalable/apps/demo.svg')),
                text(at('sub/conf.json')),
                text(resource.lookup_data('/org/gjsify/other/hello.txt', NONE)),
            ];
        },
        shows: [
            'hello\n',
            'hello\n',
            0,
            true,
            256,
            'größe\n',
            '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>\n',
            '{"a":1}\n',
            'hello\n',
        ],
    },
    {
        row: 'info',
        rule: 'get_info is [true, size, flags]; a compressed entry reports its UNCOMPRESSED size and flag 1',
        observe: (subject) => {
            const resource = open(subject);
            return [
                'hello.txt',
                'empty.txt',
                'blob.bin',
                'umlaut/größe.txt',
                'icons/scalable/apps/demo.svg',
                'sub/conf.json',
                'big.txt',
            ].map((name) => resource.get_info(`${PREFIX}/${name}`, NONE));
        },
        shows: [
            [true, 6, 0],
            [true, 0, 0],
            [true, 256, 0],
            [true, 8, 0],
            [true, 85, 0],
            [true, 8, 0],
            [true, 600, 1],
        ],
    },
    {
        row: 'enumerate',
        rule: 'children of a directory, directories with a trailing slash; one trailing slash on the path is the same path',
        observe: (subject) => {
            const resource = open(subject);
            const names = (path: string) => resource.enumerate_children(path, NONE).sort();
            return [
                names(PREFIX),
                names(`${PREFIX}/`),
                names(`${PREFIX}/icons/scalable`),
                names(`${PREFIX}/umlaut`),
                names('/org/gjsify'),
                names('/'),
            ];
        },
        shows: [
            ['aliased/', 'big.txt', 'blob.bin', 'empty.txt', 'hello.txt', 'icons/', 'sub/', 'umlaut/'],
            ['aliased/', 'big.txt', 'blob.bin', 'empty.txt', 'hello.txt', 'icons/', 'sub/', 'umlaut/'],
            ['apps/'],
            ['größe.txt'],
            ['fixture/', 'other/'],
            ['org/'],
        ],
    },
    {
        row: 'not-found',
        rule: 'a missing path, a directory asked for as data, a file asked for as a directory, and un-normalised paths are NOT_FOUND',
        observe: (subject) => {
            const resource = open(subject);
            const lookups = ['/x', 'x', '', PREFIX, `${PREFIX}/`, '/org/gjsify//fixture/hello.txt'];
            return [
                ...lookups.map((path) => attempt(subject, () => resource.lookup_data(path, NONE))),
                ...lookups.map((path) => attempt(subject, () => resource.get_info(path, NONE))),
                ...['/nope', '', `${PREFIX}/hello.txt`, `${PREFIX}//`].map((path) =>
                    attempt(subject, () => resource.enumerate_children(path, NONE)),
                ),
            ].map((outcome) => JSON.stringify(outcome));
        },
        shows: Array.from({ length: 16 }, () => JSON.stringify({ error: 'NOT_FOUND' })),
    },
    {
        row: 'registry',
        rule: 'the process-wide functions search registered resources, the most recently registered first, and see unregistration',
        observe: (subject) => {
            const { Gio } = subject;
            const { overlay } = gioResourceFixtures();
            const a = open(subject);
            const b = open(subject, overlay);
            const path = `${PREFIX}/hello.txt`;
            const read = () => attempt(subject, () => text(Gio.resources_lookup_data(path, NONE)));
            const before = read();
            const only = registered(subject, [a], read);
            const both = registered(subject, [a, b], read);
            const reversed = registered(subject, [b, a], read);
            const afterUnregister = registered(subject, [a, b], () => {
                Gio.resources_unregister(b);
                const outcome = read();
                Gio.resources_register(b);
                return outcome;
            });
            const method = (() => {
                a._register();
                try {
                    return [read(), (a._unregister(), read())];
                } finally {
                    // already unregistered by the method above
                }
            })();
            return [before, only, both, reversed, afterUnregister, ...method];
        },
        shows: [
            { error: 'NOT_FOUND' },
            { ok: 'hello\n' },
            { ok: 'overlay\n' },
            { ok: 'hello\n' },
            { ok: 'hello\n' },
            { ok: 'hello\n' },
            { error: 'NOT_FOUND' },
        ],
    },
    {
        row: 'aggregate',
        rule: 'resources_get_info and resources_enumerate_children answer for the whole registry; one miss is NOT_FOUND',
        observe: (subject) => {
            const { Gio } = subject;
            const { overlay } = gioResourceFixtures();
            const a = open(subject);
            const b = open(subject, overlay);
            return registered(subject, [a, b], () => [
                Gio.resources_get_info(`${PREFIX}/extra.txt`, NONE),
                Gio.resources_get_info(`${PREFIX}/blob.bin`, NONE),
                Gio.resources_enumerate_children(PREFIX, NONE).sort(),
                Gio.resources_enumerate_children('/org/gjsify', NONE).sort(),
                Gio.resources_enumerate_children('/', NONE),
                attempt(subject, () => Gio.resources_get_info('/nope', NONE)),
                attempt(subject, () => Gio.resources_enumerate_children('/nope', NONE)),
                attempt(subject, () => Gio.resources_enumerate_children('', NONE)),
            ]);
        },
        shows: [
            [true, 6, 0],
            [true, 256, 0],
            ['aliased/', 'big.txt', 'blob.bin', 'empty.txt', 'extra.txt', 'hello.txt', 'icons/', 'sub/', 'umlaut/'],
            ['fixture/', 'other/'],
            ['org/'],
            { error: 'NOT_FOUND' },
            { error: 'NOT_FOUND' },
            { error: 'NOT_FOUND' },
        ],
    },
];

export async function driveGioResourceVectors(
    subject: GioResourceSubject,
    harness: ConstructHarness,
    vectors: readonly GioResourceVector[] = GIO_RESOURCE_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gio resources`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
