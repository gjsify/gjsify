// SPDX-License-Identifier: MIT
//
// A smoke test of the Gio FileSystem layer's own surface.
//
// The CONFORMANCE run is not here: `tests/integration/effect` points upstream's own
// `FileSystem.test-utils.ts` at this layer, which is a stronger check than anything
// written here could be. What is left for this file is the part that is a property
// of THIS implementation rather than of the contract — an unimplemented method
// raising a defect instead of failing like a missing file, and interruption reaching
// GIO — plus enough of a smoke test that a broken layer fails HERE, in the package
// that owns it, rather than only in a suite two directories away.

import { describe, expect, it } from '@gjsify/unit';
import { Effect, Exit, Fiber, Result } from 'effect';
import * as FileSystem from 'effect/FileSystem';

import { layer } from './filesystem.js';

const run = <E, A>(self: Effect.Effect<A, E, FileSystem.FileSystem>): Promise<A> =>
    Effect.runPromise(Effect.provide(self, layer));

export default async () => {
    await describe('effect/FileSystem over Gio.File', async () => {
        await it('reads a directory GIO can see', async () => {
            const names = await run(
                Effect.gen(function* () {
                    const fs = yield* FileSystem.FileSystem;
                    return yield* fs.readDirectory('/etc');
                }),
            );
            expect(names.length > 0).toBe(true);
            expect(names.includes('passwd')).toBe(true);
        });

        await it('maps a missing path to NotFound, not to a crash', async () => {
            const error = await run(
                Effect.gen(function* () {
                    const fs = yield* FileSystem.FileSystem;
                    return yield* Effect.flip(fs.stat('/etc/there-is-no-such-entry'));
                }),
            );
            expect(error.reason._tag).toBe('NotFound');
        });

        await it('exists is derived from access and answers false rather than failing', async () => {
            const [there, notThere] = await run(
                Effect.gen(function* () {
                    const fs = yield* FileSystem.FileSystem;
                    return [yield* fs.exists('/etc/passwd'), yield* fs.exists('/etc/there-is-no-such-entry')] as const;
                }),
            );
            expect(there).toBe(true);
            expect(notThere).toBe(false);
        });

        await it('an unimplemented method DIES rather than failing as NotFound', async () => {
            // The distinction the whole `make`-instead-of-`makeNoop` decision is
            // about: a caller writing `Effect.catchTag('PlatformError', …)` must not
            // swallow "this layer cannot do that" as "the file is not there".
            const exit = await Effect.runPromiseExit(
                Effect.provide(
                    Effect.gen(function* () {
                        const fs = yield* FileSystem.FileSystem;
                        return yield* fs.realPath('/etc/passwd');
                    }),
                    layer,
                ),
            );
            expect(Exit.hasDies(exit)).toBe(true);
            expect(Exit.hasFails(exit)).toBe(false);
        });

        await it('a+ CREATES a missing file, as POSIX does', async () => {
            // Not in the conformance suite, and found by running the layer against
            // Node: `g_file_open_readwrite` refuses a path that does not exist, so an
            // earlier version answered NotFound where Node creates the file.
            const text = await run(
                Effect.gen(function* () {
                    const fs = yield* FileSystem.FileSystem;
                    const dir = yield* fs.makeTempDirectory();
                    const path = `${dir}/created-by-a-plus.txt`;
                    yield* Effect.scoped(
                        Effect.flatMap(fs.open(path, { flag: 'a+' }), (file) =>
                            file.writeAll(new TextEncoder().encode('made')),
                        ),
                    );
                    const contents = yield* fs.readFileString(path);
                    yield* fs.remove(dir, { recursive: true });
                    return contents;
                }),
            );
            expect(text).toBe('made');
        });

        await it('copy does NOT overwrite unless asked, and copies a directory', async () => {
            // Both halves diverged from the Node layer and neither is in the
            // conformance suite: it only ever passes `{ overwrite: false }` explicitly,
            // and it never copies a directory. Node's layer is
            // `force: options?.overwrite ?? false, recursive: true`.
            const result = await run(
                Effect.gen(function* () {
                    const fs = yield* FileSystem.FileSystem;
                    const root = yield* fs.makeTempDirectory();
                    yield* fs.makeDirectory(`${root}/tree/nested`, { recursive: true });
                    yield* fs.writeFileString(`${root}/tree/nested/leaf.txt`, 'leaf');
                    yield* fs.writeFileString(`${root}/taken.txt`, 'original');
                    yield* fs.writeFileString(`${root}/source.txt`, 'source');

                    const clobber = yield* Effect.flip(fs.copy(`${root}/source.txt`, `${root}/taken.txt`));
                    const copiedTree = yield* Effect.result(fs.copy(`${root}/tree`, `${root}/tree-copy`));
                    const leaf = yield* fs.readFileString(`${root}/tree-copy/nested/leaf.txt`);
                    const untouched = yield* fs.readFileString(`${root}/taken.txt`);
                    yield* fs.remove(root, { recursive: true });
                    return { reason: clobber.reason._tag, treeOk: Result.isSuccess(copiedTree), leaf, untouched };
                }),
            );
            expect(result.reason).toBe('AlreadyExists');
            expect(result.untouched).toBe('original');
            expect(result.treeOk).toBe(true);
            expect(result.leaf).toBe('leaf');
        });

        await it('interrupting a read ends the fiber as an interrupt', async () => {
            const exit = await Effect.runPromise(
                Effect.provide(
                    Effect.gen(function* () {
                        const fs = yield* FileSystem.FileSystem;
                        const fiber = yield* Effect.forkChild(fs.readDirectory('/usr/lib'), {
                            startImmediately: true,
                        });
                        yield* Fiber.interrupt(fiber);
                        return yield* Fiber.await(fiber);
                    }),
                    layer,
                ),
            );
            expect(Exit.hasInterrupts(exit)).toBe(true);
        });
    });
};
