// Runtime detection must name the runtime it is ACTUALLY on.
//
// The bug this pins: `process.versions.node` is set on three of the four
// runtimes (Bun and Deno fake it for npm compatibility, GJS's `@gjsify/process`
// shim sets it), so a `versions.node` check that runs before the Bun/Deno
// probes answers `'Node.js'` on Bun and on Deno. Silently wrong, never
// `'Unknown'` — and surfaced straight to users, since the `cli`,
// `web-server-hono` and `web-server-express` scaffolding templates all print
// `runtimeName` as the answer to "which runtime is serving this?".
//
// A detector can only be checked against the host running it, so the coverage
// that matters is running this file on all four: `test:node`, `test:gjs`,
// `test:bun`, `test:deno` (`test:cross-runtime` chains the non-GJS three).
// What each run asserts is INTERNAL CONSISTENCY plus the one cross-cutting
// invariant — the flags are mutually exclusive — which is exactly the property
// the old ordering violated.

import { describe, expect, it } from '@gjsify/unit';
import { isBun, isDeno, isGJS, isNode, runtimeName, runtimeTarget, runtimeVersion } from './index.js';

const NAME_FOR = { gjs: 'GJS', node: 'Node.js', bun: 'Bun', deno: 'Deno' } as const;

export default async (): Promise<void> => {
    await describe('@gjsify/runtime detection', async () => {
        await it('identifies exactly one runtime', async () => {
            // The whole defect in one assertion: on Bun the old implementation
            // had BOTH isBun-equivalent truth and isNode true, and isNode won.
            const flags = [isGJS, isNode, isBun, isDeno].filter(Boolean);
            expect(flags.length).toBe(1);
        });

        await it('names a runtime, never "Unknown", on a supported host', async () => {
            expect(['GJS', 'Node.js', 'Bun', 'Deno']).toContain(runtimeName);
        });

        await it('agrees with itself across name, target and flags', async () => {
            expect(runtimeTarget).toBeDefined();
            const target = runtimeTarget as keyof typeof NAME_FOR;
            expect(runtimeName).toBe(NAME_FOR[target]);
            expect({ gjs: isGJS, node: isNode, bun: isBun, deno: isDeno }[target]).toBe(true);
        });

        await it('emits a target the CLI vocabulary accepts', async () => {
            // `runtimeTarget` is the value that may be handed back to
            // `gjsify run --runtime`; `runtimeName` is prose and must not be.
            expect(['gjs', 'node', 'bun', 'deno']).toContain(runtimeTarget);
        });

        await it('reports the version of THIS runtime', async () => {
            expect(typeof runtimeVersion).toBe('string');
            expect((runtimeVersion as string).length > 0).toBeTruthy();
            // Bun and Deno report a real Node version through
            // `process.versions.node`; reading it there would be a plausible
            // number about a runtime we are not on.
            if (isBun || isDeno) {
                expect(runtimeVersion).not.toBe(
                    (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node,
                );
            }
        });
    });
};
