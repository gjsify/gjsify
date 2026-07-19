// Coverage for `@gjsify/rolldown-plugin-gjsify/runtime` host detection.
// `@gjsify/rolldown-plugin-gjsify` has no test runner of its own, so its
// public helpers are exercised here in the CLI's `test:node` harness (the CLI
// already declares the plugin as a dependency). The helpers are the single
// source of truth the CLI's bundler-pick / oxc-resolve / plugin-loading paths
// branch on.

import { describe, it, expect } from '@gjsify/unit';
import { isGjs, isNode, isBun, isDeno, hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';

// Independent host probes — deliberately NOT the helpers under test, so the
// assertions below validate the helpers against ground truth rather than
// against themselves.
const underGjs = typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';
const underBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const underDeno = typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined';

export default async () => {
    await describe('rolldown-plugin-gjsify/runtime', async () => {
        await it('returns booleans', async () => {
            expect(typeof isGjs()).toBe('boolean');
            expect(typeof isNode()).toBe('boolean');
            expect(typeof isBun()).toBe('boolean');
            expect(typeof isDeno()).toBe('boolean');
        });

        await it('the four host predicates are mutually exclusive', async () => {
            // A host is exactly one of gjs / node / bun / deno. `isNode()`
            // guards on Bun/Deno/GJS precisely because all three fake
            // `process.versions.node` (a false Node positive otherwise).
            const active = [isGjs(), isNode(), isBun(), isDeno()].filter(Boolean).length;
            expect(active).toBe(1);
        });

        await it('hostRuntime agrees with the individual predicates', async () => {
            const host = hostRuntime();
            expect(host === 'gjs' || host === 'node' || host === 'bun' || host === 'deno').toBe(true);
            expect(isGjs()).toBe(host === 'gjs');
            expect(isNode()).toBe(host === 'node');
            expect(isBun()).toBe(host === 'bun');
            expect(isDeno()).toBe(host === 'deno');
        });

        await it('detects the current host correctly', async () => {
            // This spec bundle (dist/test.node.mjs) runs under node, bun or deno
            // in CI, or under gjs when built as a gjs bundle — assert whichever
            // ground-truth probe matches. Bun/Deno are checked FIRST: they also
            // set `process.versions.node`, so isNode() must be false there.
            if (underBun) {
                expect(hostRuntime()).toBe('bun');
                expect(isBun()).toBe(true);
                expect(isNode()).toBe(false);
                expect(isGjs()).toBe(false);
            } else if (underDeno) {
                expect(hostRuntime()).toBe('deno');
                expect(isDeno()).toBe(true);
                expect(isNode()).toBe(false);
                expect(isGjs()).toBe(false);
            } else if (underGjs) {
                expect(hostRuntime()).toBe('gjs');
                expect(isGjs()).toBe(true);
                expect(isNode()).toBe(false);
            } else {
                // Plain Node.
                expect(hostRuntime()).toBe('node');
                expect(isNode()).toBe(true);
                expect(isGjs()).toBe(false);
            }
        });
    });
};
