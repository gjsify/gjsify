// Unit tests for the oxfmt dual-engine pick in oxc-resolve.ts — mirrors
// bundler-pick.spec.ts's `shouldUseNative` coverage. The Node-side test sees:
//   - process.env.GJSIFY_OXFMT respected (env-var overrides)
//   - globalThis.imports?.gi UNDEFINED (we're under Node) → default returns
//     false (npm launcher wins)
// The native-loadable path is covered under GJS by
// tests/integration/oxfmt-native/ against the real prebuild.

import { describe, expect, it } from '@gjsify/unit';
import { OxcNotFoundError, decideOxfmtEngine, shouldUseNativeOxfmt } from './oxc-resolve.js';

export default async () => {
    await describe('decideOxfmtEngine — deterministic per project', async () => {
        const base = { isGjs: true, nativeLoadable: true, embeddedVersion: '0.61.0', projectVersion: '0.61.0' };

        await it('GJS + loadable + same version → native', async () => {
            expect(decideOxfmtEngine(base).engine).toBe('native');
        });
        await it('GJS + loadable + project pins another version → npm (the lock wins)', async () => {
            expect(decideOxfmtEngine({ ...base, projectVersion: '0.56.0' }).engine).toBe('npm');
        });
        await it('a leading "v" does not count as a difference', async () => {
            expect(decideOxfmtEngine({ ...base, projectVersion: 'v0.61.0' }).engine).toBe('native');
        });
        await it('no project oxfmt → native stays the GJS default', async () => {
            expect(decideOxfmtEngine({ ...base, projectVersion: undefined }).engine).toBe('native');
        });
        await it('bridge does not report its version → native (nothing to compare)', async () => {
            expect(decideOxfmtEngine({ ...base, embeddedVersion: undefined, projectVersion: '0.56.0' }).engine).toBe(
                'native',
            );
        });
        await it('not GJS → npm, even with equal versions', async () => {
            expect(decideOxfmtEngine({ ...base, isGjs: false }).engine).toBe('npm');
        });
        await it('bridge not loadable → npm', async () => {
            expect(decideOxfmtEngine({ ...base, nativeLoadable: false }).engine).toBe('npm');
        });
        await it('override npm wins over everything', async () => {
            expect(decideOxfmtEngine({ ...base, override: 'npm' }).engine).toBe('npm');
        });
        await it('override native + version mismatch → native with ONE warning naming both versions', async () => {
            const d = decideOxfmtEngine({ ...base, projectVersion: '0.56.0', override: 'native' });
            expect(d.engine).toBe('native');
            expect(d.warning?.includes('0.61.0')).toBe(true);
            expect(d.warning?.includes('0.56.0')).toBe(true);
        });
        await it('override native + same version → native, no warning', async () => {
            const d = decideOxfmtEngine({ ...base, override: 'native' });
            expect(d.engine).toBe('native');
            expect(d.warning).toBe(undefined);
        });
        await it('override native + not loadable → error', async () => {
            const d = decideOxfmtEngine({ ...base, nativeLoadable: false, override: 'native' });
            expect(d.error?.includes('not loadable')).toBe(true);
        });
    });

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

    // Measured on a Node-less GJS host (postmarketOS/aarch64, gjs 1.88, no node):
    // oxlint WAS installed and its launcher on disk, but spawning `node` failed
    // with ENOENT and the error told the user to install oxlint — advice that
    // succeeds and changes nothing, so the next run repeats it.
    await describe('OxcNotFoundError', async () => {
        await it('blames the tool when the launcher is genuinely absent', async () => {
            const err = new OxcNotFoundError('oxlint', '/proj');
            expect(err.message).toContain('oxlint not found');
            expect(err.message).toContain('gjsify install -D oxlint');
            expect(err.missingInterpreter).toBeUndefined();
        });

        await it('blames the INTERPRETER when the launcher resolved', async () => {
            const err = new OxcNotFoundError('oxlint', '/proj', 'node');
            expect(err.message).toContain('no `node` binary on PATH');
            expect(err.message).toContain('oxlint IS installed');
            // must NOT repeat the advice the user already followed
            expect(err.message).not.toContain('gjsify install -D oxlint');
        });

        await it('points a Node-less host at the native formatter bridge', async () => {
            const err = new OxcNotFoundError('oxfmt', '/proj', 'node');
            expect(err.message).toContain('@gjsify/oxfmt-native');
        });

        await it('keeps naming oxlint as bridge-less', async () => {
            expect(new OxcNotFoundError('oxlint', '/proj', 'node').message).toContain('no native GJS bridge yet');
        });
    });
};
