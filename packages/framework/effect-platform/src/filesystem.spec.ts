// SPDX-License-Identifier: MIT
//
// A smoke test of the Gio FileSystem layer's own surface.
//
// The CONFORMANCE run is not here: `tests/integration/effect` points upstream's
// own `FileSystem.test-utils.ts` at this layer, which is a stronger check than
// anything written here could be. What this file covers is the two things that
// suite cannot ask about, because they are properties of THIS implementation
// rather than of the contract: that an unimplemented method raises a defect
// instead of failing like a missing file, and that interruption reaches GIO.

import { describe, expect, it } from '@gjsify/unit';
import { Effect, Exit, Fiber } from 'effect';
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
