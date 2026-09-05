// SPDX-License-Identifier: MIT
// Authored against packages/effect/test/ConfigProvider.test.ts's helper shape
// (effect@4.0.0-rc.112) — the upstream cases all pass an explicit `env` record, so
// none of them touches the host environment, and the host environment is the whole
// question here.
// Original helpers: Copyright (c) 2023 Effectful Technologies Inc. MIT.
//
// `ConfigProvider.fromEnv()` with no options reads `process.env`, and on GJS that
// is @gjsify/process's Proxy over `GLib.{getenv,setenv,unsetenv}`. So this asks the
// one thing the upstream file cannot: does Effect's own reader see what our Proxy
// reports, including a deletion and an empty string.
//
// The empty-string case is not a curiosity. `fromEnv` treats `""` as ABSENT by
// default, and `GLib.setenv(name, "", true)` is exactly how a shell exports an
// empty variable — so a provider that reported it as present would silently
// disagree with Node on the most common "unset it for this run" idiom.

import { describe, expect, it } from '@gjsify/unit';
import { ConfigProvider, Effect, Result } from 'effect';

const load = (provider: ConfigProvider.ConfigProvider, path: ConfigProvider.Path) =>
    Effect.runPromise(Effect.result(provider.load(path)));

const KEY = 'GJSIFY_EFFECT_CONFIG_PROBE';
/** No underscore, so it is one whole path segment — see the enumeration case. */
const FLAT_KEY = 'GJSIFYEFFECTCONFIGPROBE';

export default async () => {
    await describe('effect/ConfigProvider over process.env', async () => {
        await it('reads a value written through process.env', async () => {
            process.env[KEY] = 'from-the-host';
            try {
                const result = await load(ConfigProvider.fromEnv(), [KEY]);
                expect(result).toStrictEqual(Result.succeed(ConfigProvider.makeValue('from-the-host')));
            } finally {
                delete process.env[KEY];
            }
        });

        await it('reports a deleted variable as missing', async () => {
            process.env[KEY] = 'transient';
            delete process.env[KEY];

            const result = await load(ConfigProvider.fromEnv(), [KEY]);
            expect(result).toStrictEqual(Result.succeed(undefined));
        });

        await it('treats an exported empty string as missing', async () => {
            process.env[KEY] = '';
            try {
                const result = await load(ConfigProvider.fromEnv(), [KEY]);
                expect(result).toStrictEqual(Result.succeed(undefined));
            } finally {
                delete process.env[KEY];
            }
        });

        await it('preserves an empty string when asked to', async () => {
            process.env[KEY] = '';
            try {
                const result = await load(ConfigProvider.fromEnv({ preserveEmptyStrings: true }), [KEY]);
                expect(result).toStrictEqual(Result.succeed(ConfigProvider.makeValue('')));
            } finally {
                delete process.env[KEY];
            }
        });

        await it('enumerates the host environment as a record', async () => {
            // `load([])` asks the provider for the KEY SET, which on GJS means
            // @gjsify/process's Proxy has to answer `ownKeys` — a trap a plain
            // getter-only shim does not implement, and the one that makes
            // `Object.keys(process.env)` work.
            //
            // The root record lists FIRST PATH SEGMENTS, not variable names, because
            // `fromEnv` reads `_` as the path separator: `GJSIFY_EFFECT_CONFIG_PROBE`
            // is the path `["GJSIFY","EFFECT","CONFIG","PROBE"]` and shows up at the
            // root as `GJSIFY`. Measured, after this case first asserted the full name
            // and failed on the NODE leg — which is the leg that says the test is
            // wrong rather than the implementation.
            process.env[KEY] = 'listed';
            process.env[FLAT_KEY] = 'flat';
            try {
                const result = await load(ConfigProvider.fromEnv(), []);
                expect(Result.isSuccess(result)).toBe(true);
                if (Result.isSuccess(result)) {
                    const node = result.success as { readonly _tag: string; readonly keys: ReadonlySet<string> };
                    expect(node._tag).toBe('Record');
                    expect(node.keys.has(FLAT_KEY)).toBe(true);
                    expect(node.keys.has(KEY.slice(0, KEY.indexOf('_')))).toBe(true);
                }
            } finally {
                delete process.env[KEY];
                delete process.env[FLAT_KEY];
            }
        });
    });
};
