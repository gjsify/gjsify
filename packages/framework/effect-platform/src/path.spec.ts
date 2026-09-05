// SPDX-License-Identifier: MIT
//
// The GLib `Path` layer against the contract `effect/Path` documents.
//
// Every expectation here is Node's `path.posix` behaviour, because that is what
// `effect/Path` means by each method and what a consumer swapping this layer for
// `NodePath.layer` will have been relying on. Where GLib differs the difference is
// the finding, not the expectation.

import { describe, expect, it } from '@gjsify/unit';
import { Effect } from 'effect';
import * as Path from 'effect/Path';

import { layer } from './path.js';

const run = <E, A>(self: Effect.Effect<A, E, Path.Path>): Promise<A> => Effect.runPromise(Effect.provide(self, layer));

const withPath = (f: (path: Path.Path) => void) =>
    run(
        Effect.gen(function* () {
            f(yield* Path.Path);
        }),
    );

export default async () => {
    await describe('effect/Path over GLib', async () => {
        await it('sep is the platform separator', async () => {
            await withPath((path) => expect(path.sep).toBe('/'));
        });

        await it('join collapses repeated separators', async () => {
            // `g_build_filenamev`'s documented behaviour, and Node's too.
            await withPath((path) => {
                expect(path.join('/tmp', 'a', 'b.txt')).toBe('/tmp/a/b.txt');
                expect(path.join('/tmp/', '/a/', '/b.txt')).toBe('/tmp/a/b.txt');
                expect(path.join('a', '', 'b')).toBe('a/b');
                expect(path.join()).toBe('');
            });
        });

        await it('basename, dirname and extname split a path', async () => {
            await withPath((path) => {
                expect(path.basename('/tmp/a/notes.md')).toBe('notes.md');
                expect(path.basename('/tmp/a/notes.md', '.md')).toBe('notes');
                expect(path.dirname('/tmp/a/notes.md')).toBe('/tmp/a');
                expect(path.extname('/tmp/a/notes.md')).toBe('.md');
                expect(path.extname('/tmp/a/notes')).toBe('');
                // A leading dot is not an extension, in Node and here.
                expect(path.extname('/tmp/a/.bashrc')).toBe('');
            });
        });

        await it('isAbsolute answers for both shapes', async () => {
            await withPath((path) => {
                expect(path.isAbsolute('/tmp')).toBe(true);
                expect(path.isAbsolute('tmp')).toBe(false);
            });
        });

        await it('normalize removes . and .. without touching the disk', async () => {
            await withPath((path) => {
                expect(path.normalize('/tmp/./a/../b')).toBe('/tmp/b');
                expect(path.normalize('a/./b/../c')).toBe('a/c');
                expect(path.normalize('')).toBe('.');
            });
        });

        await it('resolve makes an absolute path from segments', async () => {
            await withPath((path) => {
                expect(path.resolve('/tmp', 'a', 'b')).toBe('/tmp/a/b');
                // A later absolute segment discards what came before it.
                expect(path.resolve('/tmp', '/etc', 'x')).toBe('/etc/x');
            });
        });

        await it('relative walks up and back down', async () => {
            await withPath((path) => {
                expect(path.relative('/tmp/a/b', '/tmp/a/c')).toBe('../c');
                expect(path.relative('/tmp/a', '/tmp/a/b')).toBe('b');
                expect(path.relative('/tmp/a', '/tmp/a')).toBe('');
            });
        });

        await it('parse and format round-trip', async () => {
            await withPath((path) => {
                const parsed = path.parse('/tmp/a/notes.md');
                expect(parsed.root).toBe('/');
                expect(parsed.dir).toBe('/tmp/a');
                expect(parsed.base).toBe('notes.md');
                expect(parsed.name).toBe('notes');
                expect(parsed.ext).toBe('.md');
                expect(path.format(parsed)).toBe('/tmp/a/notes.md');
            });
        });

        await it('file URLs round-trip through GLib', async () => {
            await run(
                Effect.gen(function* () {
                    const path = yield* Path.Path;
                    expect(yield* path.fromFileUrl(new URL('file:///tmp/file.txt'))).toBe('/tmp/file.txt');
                    expect((yield* path.toFileUrl('/tmp/file.txt')).href).toBe('file:///tmp/file.txt');
                }),
            );
        });

        await it('a non-file URL is a BadArgument, not a crash', async () => {
            const error = await run(
                Effect.gen(function* () {
                    const path = yield* Path.Path;
                    return yield* Effect.flip(path.fromFileUrl(new URL('http://example.com/x')));
                }),
            );
            expect(error._tag).toBe('BadArgument');
            expect(error.method).toBe('fromFileUrl');
        });

        await it('a percent-encoded URL decodes to real bytes', async () => {
            // `g_filename_from_uri` is the encoding GIO itself round-trips, which is
            // the reason to use it rather than hand-rolling the decode.
            await run(
                Effect.gen(function* () {
                    const path = yield* Path.Path;
                    expect(yield* path.fromFileUrl(new URL('file:///tmp/a%20b/c%2Bd.txt'))).toBe('/tmp/a b/c+d.txt');
                }),
            );
        });
    });
};
