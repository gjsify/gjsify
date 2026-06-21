// Coverage for `@gjsify/rolldown-plugin-gjsify/runtime` host detection.
// `@gjsify/rolldown-plugin-gjsify` has no test runner of its own, so its
// public helpers are exercised here in the CLI's `test:node` harness (the CLI
// already declares the plugin as a dependency). The helpers are the single
// source of truth the CLI's bundler-pick / oxc-resolve / plugin-loading paths
// branch on.

import { describe, it, expect } from '@gjsify/unit';
import { isGjs, isNode } from '@gjsify/rolldown-plugin-gjsify/runtime';

// Independent host probe — deliberately NOT the helpers under test, so the
// assertions below validate the helpers against ground truth rather than
// against themselves.
const underGjs = typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';

export default async () => {
    await describe('rolldown-plugin-gjsify/runtime', async () => {
        await it('returns booleans', async () => {
            expect(typeof isGjs()).toBe('boolean');
            expect(typeof isNode()).toBe('boolean');
        });

        await it('isGjs and isNode are mutually exclusive', async () => {
            // A host is GJS or Node, never both — `isNode()` guards on
            // `isGjs()` precisely because `@gjsify/process` sets
            // `process.versions.node` under GJS (a false Node positive).
            expect(isGjs() && isNode()).toBe(false);
        });

        await it('detects the current host correctly', async () => {
            if (underGjs) {
                expect(isGjs()).toBe(true);
                expect(isNode()).toBe(false);
            } else {
                // The CLI test harness runs under Node.
                expect(isGjs()).toBe(false);
                expect(isNode()).toBe(true);
            }
        });
    });
};
