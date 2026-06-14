// Guard test for `gjsify build` under the GJS runtime.
//
// The handler must detect GJS early (before any node:* resolver code runs)
// and emit a friendly, actionable error instead of a cryptic ImportError.
// We exercise the guard logic by temporarily shimming globalThis.imports.gi
// to simulate a GJS environment, then verify the handler throws with the
// expected message.
//
// The Node-path smoke test calls isGjsRuntime() directly to confirm it
// returns false in the real Node environment, verifying the guard never
// fires in production Node builds.

import { describe, expect, it } from '@gjsify/unit';
import { isGjsRuntime, buildCommand } from './commands/build.js';
import type { ArgumentsCamelCase } from 'yargs';

type BuildArgs = ArgumentsCamelCase<{
    entryPoints?: string[];
    library?: boolean;
    app?: string;
    watch?: boolean;
}>;

/** Temporarily set globalThis.imports.gi to simulate GJS, call fn, then restore. */
function withGjsGlobal<T>(fn: () => T): T {
    const g = globalThis as {
        imports?: { gi?: Record<string, unknown> };
    };
    const original = g.imports;
    g.imports = { gi: {} };
    try {
        return fn();
    } finally {
        g.imports = original;
    }
}

export default async () => {
    await describe('isGjsRuntime()', async () => {
        await it('returns false under Node.js (no globalThis.imports.gi)', () => {
            expect(isGjsRuntime()).toBe(false);
        });

        await it('returns true when globalThis.imports.gi is present (simulated GJS)', () => {
            const result = withGjsGlobal(() => isGjsRuntime());
            expect(result).toBe(true);
        });
    });

    await describe('buildCommand.handler — GJS guard', async () => {
        await it('throws with a friendly message when running under GJS', async () => {
            // Minimal args — handler must exit before reaching Config/BuildAction.
            const args = {
                library: false,
                app: 'gjs',
                watch: false,
            } as unknown as BuildArgs;

            let threw = false;
            let errorMessage = '';
            try {
                await withGjsGlobal(async () => {
                    await buildCommand.handler!(args);
                });
            } catch (err) {
                threw = true;
                errorMessage = err instanceof Error ? err.message : String(err);
            }

            expect(threw).toBe(true);
            // Message must mention Node.js and suggest npx gjsify build.
            expect(errorMessage.includes('Node.js')).toBe(true);
            expect(errorMessage.includes('npx gjsify build')).toBe(true);
            // Must NOT expose the confusing rolldown-native diagnostic.
            expect(errorMessage.includes('rolldown-native')).toBe(false);
        });

        await it('does NOT throw under Node.js (isGjsRuntime() is false)', async () => {
            // We cannot fully run the handler on Node without a real project dir,
            // but we verify the guard itself doesn't trigger by checking that
            // isGjsRuntime() is false, meaning the early-return branch is skipped.
            // The handler will throw later (no package.json in cwd) — that's
            // expected and unrelated to the guard.
            expect(isGjsRuntime()).toBe(false);
        });
    });
};
