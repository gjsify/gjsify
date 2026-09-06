// SPDX-License-Identifier: MIT
// Ported from packages/effect/test/FileSystem.test-utils.ts (effect@4.0.0-rc.112),
// driven by the layers packages/platform/node-shared/test/NodeFileSystem.test.ts
// points it at.
// Original: Copyright (c) 2023 Effectful Technologies Inc. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// WHY THIS IS THE SUITE'S CENTREPIECE. Upstream authored `FileSystem.test-utils.ts`
// as a layer-PARAMETERISED conformance suite so that Node, Bun and Deno answer the
// same questions about the same contract. This port keeps that shape, which is what
// lets it be pointed at two layers here: `NodeFileSystem.layer` on @gjsify/fs, and
// `@gjsify/effect-platform`'s Gio one. Neither implementation chose these
// questions, and nobody in this repo would have written them, because they ask
// about the file CURSOR: seek forwards, seek backwards, read without an intervening
// seek, write in `a+` where the read and write positions are separate, truncate
// under a live cursor.
//
// BOTH LAYERS PASS ALL OF IT, which is why there is no per-layer escape hatch in
// this file. Should one appear, the tool is `it.failing(name, fn, reason)` — it RUNS the
// case and turns red the day it starts passing — never a skip and never an
// `if (layer === …)`, because a gap that cannot retire itself is a gap nobody
// removes.
//
// Dialect notes, all mechanical:
//   `it.skipIf(o.x === false)(…)`     the options object is ours and sets neither
//                                     flag, so both cases are included unguarded
//   `assert(cond)` / `assert.strictEqual`  → `expect(…).toBe(…)`
//   `expect(x).toEqual(y)`            → `toBe` for primitives, `toStrictEqual` else
//   `__dirname`                       → FIXTURES_DIR, resolved off `import.meta.url`

import { describe, expect, it } from '@gjsify/unit';
import { Array as Arr, Effect, type Layer, Result, Stream } from 'effect';
import * as Fs from 'effect/FileSystem';

import { FIXTURES_DIR } from './fixtures.js';

export interface ConformanceOptions {
    /** Named in the describe block, so a failure says which layer produced it. */
    readonly label: string;
    readonly layer: Layer.Layer<Fs.FileSystem>;
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** `file.readAlloc` as text. Five cursor cases below read exactly this way. */
const readText = (file: Fs.File, size: number) =>
    file.readAlloc(Fs.Size(size)).pipe(Effect.flatMap(Effect.fromOption), Effect.map(decode));

export const conformance = (options: ConformanceOptions) => async () => {
    const run = <E, A>(self: Effect.Effect<A, E, Fs.FileSystem>): Promise<A> =>
        Effect.runPromise(Effect.provide(self, options.layer));

    await describe(`effect/FileSystem over ${options.label}`, async () => {
        await it('readFile', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const data = yield* fs.readFile(`${FIXTURES_DIR}/text.txt`);
                    expect(decode(data).trim()).toBe('lorem ipsum dolar sit amet');
                }),
            );
        });

        await it('makeTempDirectory', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    let dir = '';
                    yield* Effect.scoped(
                        Effect.gen(function* () {
                            dir = yield* fs.makeTempDirectory();
                            const stat = yield* fs.stat(dir);
                            expect(stat.type).toBe('Directory');
                        }),
                    );
                    // Unscoped: the directory OUTLIVES the scope that made it.
                    const stat = yield* fs.stat(dir);
                    expect(stat.type).toBe('Directory');
                }),
            );
        });

        await it('makeTempDirectoryScoped', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    let dir = '';
                    yield* Effect.scoped(
                        Effect.gen(function* () {
                            dir = yield* fs.makeTempDirectoryScoped();
                            const stat = yield* fs.stat(dir);
                            expect(stat.type).toBe('Directory');
                        }),
                    );
                    const error = yield* Effect.flip(fs.stat(dir));
                    expect(error.reason._tag).toBe('NotFound');
                }),
            );
        });

        await it('access on a writable directory', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    yield* Effect.scoped(
                        Effect.gen(function* () {
                            const dir = yield* fs.makeTempDirectoryScoped();
                            yield* fs.access(dir, { writable: true });
                        }),
                    );
                }),
            );
        });

        await it('makeTempFileScoped cleans up', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    yield* Effect.scoped(
                        Effect.gen(function* () {
                            const root = yield* fs.makeTempDirectoryScoped();
                            let file = '';
                            let dir = '';
                            yield* Effect.scoped(
                                Effect.gen(function* () {
                                    file = yield* fs.makeTempFileScoped({ directory: root });
                                    const separator = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
                                    expect(separator > 0).toBe(true);
                                    dir = file.slice(0, separator);
                                    const stat = yield* fs.stat(dir);
                                    expect(stat.type).toBe('Directory');
                                }),
                            );
                            const fileError = yield* Effect.flip(fs.stat(file));
                            expect(fileError.reason._tag).toBe('NotFound');
                            const directoryError = yield* Effect.flip(fs.stat(dir));
                            expect(directoryError.reason._tag).toBe('NotFound');
                        }),
                    );
                }),
            );
        });

        await it('truncate', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const file = yield* fs.makeTempFile();

                    const text = 'hello world';
                    yield* fs.writeFile(file, encode(text));
                    expect(decode(yield* fs.readFile(file))).toBe(text);

                    yield* fs.truncate(file);
                    expect(decode(yield* fs.readFile(file))).toBe('');
                }),
            );
        });

        await it('writeFile with r+ overwrites without truncating', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const path = yield* fs.makeTempFile();

                    yield* fs.writeFileString(path, 'abcdef');
                    yield* fs.writeFileString(path, 'xy', { flag: 'r+' });

                    expect(yield* fs.readFileString(path)).toBe('xycdef');
                }),
            );
        });

        await it('writeFile with empty data honors the flag', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const path = yield* fs.makeTempFile();

                    yield* fs.writeFileString(path, 'abc');
                    yield* fs.writeFileString(path, '');
                    expect(yield* fs.readFileString(path)).toBe('');

                    yield* fs.writeFileString(path, 'abc');
                    yield* fs.writeFileString(path, '', { flag: 'r+' });
                    expect(yield* fs.readFileString(path)).toBe('abc');
                }),
            );
        });

        await it('writeFile with r rejects writes', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const path = yield* fs.makeTempFile();

                    const error = yield* Effect.flip(fs.writeFileString(path, 'data', { flag: 'r' }));

                    // Upstream's `assert(error.reason._tag !== "BadArgument")` both
                    // asserts and NARROWS; `expect` only asserts, so the narrowing is
                    // spelled out — `pathOrDescriptor` exists on `SystemError` and not
                    // on `BadArgument`.
                    const reason = error.reason;
                    expect(reason._tag !== 'BadArgument').toBe(true);
                    if (reason._tag === 'BadArgument') return;
                    expect(reason.method).toBe('writeFile');
                    expect(reason.pathOrDescriptor).toBe(path);
                    expect(yield* fs.readFileString(path)).toBe('');
                }),
            );
        });

        await it('writeFile with a appends', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const path = yield* fs.makeTempFile();

                    yield* fs.writeFileString(path, 'abc');
                    yield* fs.writeFileString(path, 'def', { flag: 'a' });

                    expect(yield* fs.readFileString(path)).toBe('abcdef');
                }),
            );
        });

        await it('writeFile with wx exclusively creates', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const root = yield* fs.makeTempDirectory();
                    const path = `${root}/file.txt`;

                    yield* fs.writeFileString(path, 'first', { flag: 'wx' });
                    yield* Effect.flip(fs.writeFileString(path, 'second', { flag: 'wx' }));

                    expect(yield* fs.readFileString(path)).toBe('first');
                }),
            );
        });

        await it('copy with overwrite false preserves an existing destination', async () => {
            await run(
                Effect.gen(function* () {
                    const fs = yield* Fs.FileSystem;
                    const root = yield* fs.makeTempDirectory();
                    const source = `${root}/source.txt`;
                    const destination = `${root}/destination.txt`;
                    yield* fs.writeFileString(source, 'source');
                    yield* fs.writeFileString(destination, 'destination');

                    const result = yield* Effect.result(fs.copy(source, destination, { overwrite: false }));

                    if (Result.isFailure(result)) {
                        // Narrowed the way the `writeFile with r` case above narrows:
                        // ASSERT the tag first, then return, so a `BadArgument` fails
                        // here instead of skipping the block. An earlier version put
                        // `!== 'BadArgument'` in the `if` and silently passed on it.
                        const reason = result.failure.reason;
                        expect(reason._tag).toBe('AlreadyExists');
                        if (reason._tag === 'BadArgument') return;
                        expect(reason.method).toBe('copy');
                        expect(reason.pathOrDescriptor).toBe(source);
                    }
                    expect(yield* fs.readFileString(source)).toBe('source');
                    expect(yield* fs.readFileString(destination)).toBe('destination');
                }),
            );
        });

        await it('should track the cursor position when reading', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const file = yield* fs.open(`${FIXTURES_DIR}/text.txt`);

                        expect(yield* readText(file, 5)).toBe('lorem');

                        yield* file.seek(Fs.Size(7), 'current');
                        expect(yield* readText(file, 5)).toBe('dolar');

                        yield* file.seek(Fs.Size(1), 'current');
                        expect(yield* readText(file, 8)).toBe('sit amet');

                        yield* file.seek(Fs.Size(0), 'start');
                        expect(yield* readText(file, 11)).toBe('lorem ipsum');

                        const streamed = yield* fs
                            .stream(`${FIXTURES_DIR}/text.txt`, { offset: Fs.Size(6), bytesToRead: Fs.Size(5) })
                            .pipe(Stream.map(decode), Stream.runCollect, Effect.map(Arr.join('')));
                        expect(streamed).toBe('ipsum');
                    }),
                ),
            );
        });

        await it('should read from a backwards seek', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const file = yield* fs.open(`${FIXTURES_DIR}/text.txt`);

                        expect(yield* readText(file, 5)).toBe('lorem');
                        yield* file.seek(Fs.Size(-3), 'current');
                        expect(yield* readText(file, 3)).toBe('rem');
                    }),
                ),
            );
        });

        await it('should read sequentially without an intervening seek', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const file = yield* fs.open(`${FIXTURES_DIR}/text.txt`);

                        expect(yield* readText(file, 5)).toBe('lorem');
                        expect(yield* readText(file, 6)).toBe(' ipsum');
                    }),
                ),
            );
        });

        await it('should track the cursor position when writing', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const path = yield* fs.makeTempFileScoped();
                        const file = yield* fs.open(path, { flag: 'w+' });

                        yield* file.write(encode('lorem ipsum'));
                        yield* file.write(encode(' '));
                        yield* file.write(encode('dolor sit amet'));
                        expect(yield* fs.readFileString(path)).toBe('lorem ipsum dolor sit amet');

                        yield* file.seek(Fs.Size(-4), 'current');
                        yield* file.write(encode('hello world'));
                        expect(yield* fs.readFileString(path)).toBe('lorem ipsum dolor sit hello world');

                        yield* file.seek(Fs.Size(6), 'start');
                        yield* file.write(encode('blabl'));
                        expect(yield* fs.readFileString(path)).toBe('lorem blabl dolor sit hello world');
                    }),
                ),
            );
        });

        await it('should maintain a read cursor in append mode', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const path = yield* fs.makeTempFileScoped();
                        const file = yield* fs.open(path, { flag: 'a+' });

                        yield* file.write(encode('foo'));
                        yield* file.seek(Fs.Size(0), 'start');

                        // `a+` keeps the WRITE position at the end regardless of the seek,
                        // and the read position where the seek left it. Two cursors, one
                        // descriptor — the case a single-position implementation passes
                        // every other test in this file while getting wrong.
                        yield* file.write(encode('bar'));
                        expect(yield* fs.readFileString(path)).toBe('foobar');

                        expect(yield* readText(file, 3)).toBe('foo');

                        yield* file.write(encode('baz'));
                        expect(yield* fs.readFileString(path)).toBe('foobarbaz');

                        expect(yield* readText(file, 6)).toBe('barbaz');
                    }),
                ),
            );
        });

        await it('should restore the read cursor after an append write', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const path = yield* fs.makeTempFileScoped();
                        const file = yield* fs.open(path, { flag: 'a+' });

                        yield* file.write(encode('foo'));
                        yield* file.seek(Fs.Size(0), 'start');
                        expect(yield* readText(file, 1)).toBe('f');

                        yield* file.write(encode('bar'));
                        expect(yield* readText(file, 2)).toBe('oo');
                    }),
                ),
            );
        });

        await it("should keep the current cursor if truncating doesn't affect it", async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const path = yield* fs.makeTempFileScoped();
                        const file = yield* fs.open(path, { flag: 'w+' });

                        yield* file.write(encode('lorem ipsum dolor sit amet'));
                        yield* file.seek(Fs.Size(6), 'start');
                        yield* file.truncate(Fs.Size(11));

                        expect(yield* file.seek(Fs.Size(0), 'current')).toBe(Fs.Size(6));
                    }),
                ),
            );
        });

        await it('should update the current cursor if truncating affects it', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const path = yield* fs.makeTempFileScoped();
                        const file = yield* fs.open(path, { flag: 'w+' });

                        yield* file.write(encode('lorem ipsum dolor sit amet'));
                        yield* file.truncate(Fs.Size(11));

                        expect(yield* file.seek(Fs.Size(0), 'current')).toBe(Fs.Size(11));
                    }),
                ),
            );
        });

        await it('should read from the clamped cursor after truncating', async () => {
            await run(
                Effect.scoped(
                    Effect.gen(function* () {
                        const fs = yield* Fs.FileSystem;
                        const path = yield* fs.makeTempFileScoped();
                        const file = yield* fs.open(path, { flag: 'w+' });

                        yield* file.write(encode('abcdefghij'));
                        yield* file.truncate(Fs.Size(5));
                        yield* fs.writeFile(path, encode('xyz'), { flag: 'a' });

                        const text = yield* file
                            .readAlloc(Fs.Size(3))
                            .pipe(Effect.flatMap(Effect.fromOption), Effect.map(decode));
                        expect(text).toBe('xyz');
                    }),
                ),
            );
        });
    });
};
