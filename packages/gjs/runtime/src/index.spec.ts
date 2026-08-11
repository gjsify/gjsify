// Invariant: runtime detection names the runtime it is ACTUALLY on, and the flags
// are mutually exclusive — the property a `process.versions.node` check violates,
// since Bun, Deno and `@gjsify/process` all set that field (see `./index.ts`).
//
// A detector can only be checked against the host running it, so the coverage that
// matters is running this file on all four: `test:node`, `test:gjs`, `test:bun`,
// `test:deno` (`test:cross-runtime` chains the non-GJS three).

import { describe, expect, it } from '@gjsify/unit';
import { isBun, isDeno, isGJS, isNode, runtimeName, runtimeTarget, runtimeVersion } from './index.js';

const NAME_FOR = { gjs: 'GJS', node: 'Node.js', bun: 'Bun', deno: 'Deno' } as const;

export default async (): Promise<void> => {
    await describe('@gjsify/runtime detection', async () => {
        await it('identifies exactly one runtime', async () => {
            // The defect in one assertion: on Bun both the Bun flag and isNode were
            // true, and isNode won.
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
            // Only `runtimeTarget` may be handed back to `gjsify run --runtime`.
            expect(['gjs', 'node', 'bun', 'deno']).toContain(runtimeTarget);
        });

        await it('reports the version of THIS runtime', async () => {
            expect(typeof runtimeVersion).toBe('string');
            expect((runtimeVersion as string).length > 0).toBeTruthy();
            // `process.versions.node` on Bun/Deno is a plausible number about a
            // runtime we are not on.
            if (isBun || isDeno) {
                expect(runtimeVersion).not.toBe(
                    (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node,
                );
            }
        });
    });
};
