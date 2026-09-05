// SPDX-License-Identifier: MIT
// Ported from packages/platform/node-shared/test/NodePath.test.ts (effect@4.0.0-rc.112).
// Original: Copyright (c) 2023 Effectful Technologies Inc. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// `NodePath.layer{Posix,Win32}` are thin wrappers over `node:path`'s two flavours
// plus `fileURLToPath`/`pathToFileURL`, so this runs @gjsify/{path,url} against
// them. The win32 leg is the interesting half on a Linux host: it exercises the
// `path.win32` branch, which nothing else in this tree calls, and it asserts the
// drive-letter round trip that a `file:///C:/…` URL has to survive.
//
// Dialect: `it.layer(l)("name", (it) => it.effect(…))` collapses to providing the
// layer at the call, which is what `it.layer` does underneath.

import * as NodePath from '@effect/platform-node-shared/NodePath';
import { describe, expect, it } from '@gjsify/unit';
import { Effect } from 'effect';
import type * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';

const withLayer = <E, A>(layer: Layer.Layer<Path.Path>, self: Effect.Effect<A, E, Path.Path>): Promise<A> =>
    Effect.runPromise(Effect.provide(self, layer));

export default async () => {
    await describe('effect/Path over node:path', async () => {
        await it('POSIX file URLs use POSIX conversions', async () => {
            await withLayer(
                NodePath.layerPosix,
                Effect.gen(function* () {
                    const path = yield* Path.Path;

                    expect(yield* path.fromFileUrl(new URL('file:///tmp/file.txt'))).toBe('/tmp/file.txt');
                    expect((yield* path.toFileUrl('/tmp/file.txt')).href).toBe('file:///tmp/file.txt');
                }),
            );
        });

        await it('Windows file URLs use Windows conversions', async () => {
            await withLayer(
                NodePath.layerWin32,
                Effect.gen(function* () {
                    const path = yield* Path.Path;

                    expect(yield* path.fromFileUrl(new URL('file:///C:/Users/me/file.txt'))).toBe(
                        'C:\\Users\\me\\file.txt',
                    );
                    expect((yield* path.toFileUrl('C:\\Users\\me\\file.txt')).href).toBe(
                        'file:///C:/Users/me/file.txt',
                    );
                }),
            );
        });
    });
};
