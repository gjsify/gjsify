// `checkDependencies` has to answer TWO questions with one probe: is the tool
// there, and — if it is — does it run? It used to answer only the first, for
// both, and the install hint it prints at someone who has gettext installed is
// the same wrong turn `@gjsify/vite-plugin-blueprint` documents in
// `resolve-compiler.ts`: a compiler that WAS present read as unavailable,
// because the message never distinguished absent from broken.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDependencies } from './utils.js';

/** What `fn` rejected with, so a case can assert on the message it carries. */
async function rejectionOf(fn: () => Promise<unknown>): Promise<Error | undefined> {
    try {
        await fn();
    } catch (error) {
        return error as Error;
    }
    return undefined;
}

/**
 * A command that EXISTS and fails, printing `stderr` — a stand-in for a gettext
 * whose libintl went missing in a partial upgrade. A real executable rather
 * than a stubbed `execa`, because the branch under test reads `error.code`,
 * which is set by the spawn itself and is exactly what a mock would have to
 * guess.
 */
function brokenTool(stderr: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'gettext-utils-spec-'));
    const file = join(dir, 'msgfmt');
    writeFileSync(file, `#!/bin/sh\necho '${stderr}' >&2\nexit 1\n`);
    chmodSync(file, 0o755);
    return file;
}

export default async () => {
    await describe('checkDependencies', async () => {
        await it('tells someone with no gettext to install gettext', async () => {
            const error = await rejectionOf(() =>
                checkDependencies('definitely-not-a-real-binary-xyz', 'vite-plugin-gettext', false),
            );

            expect(error !== undefined).toBe(true);
            expect((error as Error).message.includes('not found')).toBe(true);
            // The hint is the whole point of this branch — it must survive.
            expect((error as Error).message.includes('sudo dnf install gettext')).toBe(true);
        });

        await it('reports an INSTALLED tool that fails with its own stderr', async () => {
            const detail = 'libintl.so.8: cannot open shared object file';
            const error = await rejectionOf(() => checkDependencies(brokenTool(detail), 'vite-plugin-gettext', false));

            expect(error !== undefined).toBe(true);
            // The line that says what is actually wrong.
            expect((error as Error).message.includes(detail)).toBe(true);
            // And NOT the install hint: it is there, installing it again fixes
            // nothing, and saying so sends the reader down the wrong path.
            expect((error as Error).message.includes('sudo dnf install gettext')).toBe(false);
        });
    });
};
