// Unit tests for the oxfmt dual-engine pick in oxc-resolve.ts — mirrors
// bundler-pick.spec.ts's `shouldUseNative` coverage. The Node-side test sees:
//   - process.env.GJSIFY_OXFMT respected (env-var overrides)
//   - globalThis.imports?.gi UNDEFINED (we're under Node) → default returns
//     false (npm launcher wins)
// The native-loadable path is covered under GJS by
// tests/integration/oxfmt-native/ against the real prebuild.

import { describe, expect, it } from '@gjsify/unit';
import { shouldUseNativeOxfmt } from './oxc-resolve.js';

export default async () => {
    await describe('shouldUseNativeOxfmt — engine pick', async () => {
        await it('GJSIFY_OXFMT=npm forces the npm launcher path', async () => {
            const prev = process.env.GJSIFY_OXFMT;
            process.env.GJSIFY_OXFMT = 'npm';
            try {
                expect(await shouldUseNativeOxfmt()).toBe(false);
            } finally {
                if (prev === undefined) delete process.env.GJSIFY_OXFMT;
                else process.env.GJSIFY_OXFMT = prev;
            }
        });

        await it('GJSIFY_OXFMT=native throws under Node when prebuild not loadable', async () => {
            const prev = process.env.GJSIFY_OXFMT;
            process.env.GJSIFY_OXFMT = 'native';
            try {
                let thrown: Error | null = null;
                try {
                    await shouldUseNativeOxfmt();
                } catch (e) {
                    thrown = e as Error;
                }
                expect(thrown !== null).toBe(true);
                expect((thrown as Error).message.includes('not loadable')).toBe(true);
            } finally {
                if (prev === undefined) delete process.env.GJSIFY_OXFMT;
                else process.env.GJSIFY_OXFMT = prev;
            }
        });

        await it('default under Node = false (no imports.gi, npm launcher wins)', async () => {
            const prev = process.env.GJSIFY_OXFMT;
            delete process.env.GJSIFY_OXFMT;
            try {
                // Under the Node test runner, globalThis.imports?.gi is
                // undefined, so the runtime-aware default must pick npm.
                expect(await shouldUseNativeOxfmt()).toBe(false);
            } finally {
                if (prev !== undefined) process.env.GJSIFY_OXFMT = prev;
            }
        });
    });
};
