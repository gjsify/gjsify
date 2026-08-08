// SPDX-License-Identifier: MIT
// Unit coverage for the showcase runtime pre-flight (#1069).
//
// The pre-flight exists to stop `showcase <gjs-only> --runtime node` from
// downloading the whole dlx tree — plus the pinned native `@gjsify/node-gi`
// bridge, fetched BECAUSE `--runtime node` was requested — before reading the
// declaration that rejects the run.
//
// Every test here is about ONE contract: the pre-flight may only ever turn a run
// that WOULD have failed into a faster failure. It must never fail a run that
// would have worked. That property is entirely a question of which branches
// answer `undefined` ("cannot say" → install, then let the on-disk check decide),
// so those are the cases worth pinning.

import { describe, expect, it } from '@gjsify/unit';
import type { Packument } from '@gjsify/npm-registry';

import { declaredRuntimesFromPackument } from './showcase.js';

/** A packument carrying `versions` + `dist-tags`, shaped like the registry's. */
function packument(versions: Record<string, unknown>, latest?: string): Packument {
    return {
        name: '@gjsify/example-gtk-adwaita-storybook',
        'dist-tags': latest ? { latest } : {},
        versions,
    } as unknown as Packument;
}

const gjsOnly = { gjsify: { example: { runtimes: ['gjs'] } } };

export default async () => {
    await describe('showcase pre-flight: declaredRuntimesFromPackument', async () => {
        await it('reads the declaration of the PINNED version', async () => {
            // The real shape, verified against the live registry:
            // `.versions["0.31.0"].gjsify.example.runtimes === ["gjs"]`.
            const doc = packument({ '0.31.0': gjsOnly }, '0.31.0');
            expect(declaredRuntimesFromPackument(doc, '0.31.0')).toStrictEqual(['gjs']);
        });

        await it('does NOT let another version answer for the pinned one', async () => {
            // 0.31.0 says gjs-only; 0.30.0 claims node. Asking about 0.30.0 must
            // not return 0.31.0's answer, or the pre-flight would reject a run
            // the installed showcase actually supports.
            const doc = packument(
                { '0.30.0': { gjsify: { example: { runtimes: ['gjs', 'node'] } } }, '0.31.0': gjsOnly },
                '0.31.0',
            );
            expect(declaredRuntimesFromPackument(doc, '0.30.0')).toStrictEqual(['gjs', 'node']);
        });

        await it('says "cannot say" for a pinned version that is not published', async () => {
            // A dev / pre-release CLI is the normal way here. Falling back to
            // `latest` would answer a DIFFERENT question, so it must not.
            const doc = packument({ '0.31.0': gjsOnly }, '0.31.0');
            expect(declaredRuntimesFromPackument(doc, '0.32.0-dev.1')).toBe(undefined);
        });

        await it('falls back to dist-tags.latest only when nothing is pinned', async () => {
            const doc = packument({ '0.31.0': gjsOnly }, '0.31.0');
            expect(declaredRuntimesFromPackument(doc, undefined)).toStrictEqual(['gjs']);
        });

        await it('says "cannot say" with no pin and no latest tag', async () => {
            const doc = packument({ '0.31.0': gjsOnly });
            expect(declaredRuntimesFromPackument(doc, undefined)).toBe(undefined);
        });

        await it('is PERMISSIVE for a version that declares nothing', async () => {
            // `null` is "unconstrained", which `checkRuntimeSupported` accepts —
            // distinct from `undefined` ("could not determine"). Both let the run
            // proceed; conflating them would be harmless today and wrong the
            // moment either side grows a behaviour.
            const doc = packument({ '0.31.0': { name: 'x' } }, '0.31.0');
            expect(declaredRuntimesFromPackument(doc, '0.31.0')).toBe(null);
        });

        await it('is permissive for a malformed declaration rather than guessing', async () => {
            const doc = packument({ '0.31.0': { gjsify: { example: { runtimes: 'gjs' } } } }, '0.31.0');
            expect(declaredRuntimesFromPackument(doc, '0.31.0')).toBe(null);
        });

        await it('drops an unknown runtime name instead of hard-failing an older CLI', async () => {
            const doc = packument({ '0.31.0': { gjsify: { example: { runtimes: ['gjs', 'wasmtime'] } } } }, '0.31.0');
            expect(declaredRuntimesFromPackument(doc, '0.31.0')).toStrictEqual(['gjs']);
        });

        await it('says "cannot say" for a document with no versions map', async () => {
            const doc = { name: 'x', 'dist-tags': { latest: '1.0.0' } } as unknown as Packument;
            expect(declaredRuntimesFromPackument(doc, undefined)).toBe(undefined);
        });
    });
};
