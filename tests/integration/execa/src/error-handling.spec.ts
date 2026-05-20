// SPDX-License-Identifier: MIT
// Inspired by node_modules/execa/index.d.ts (ExecaError) and the README
// "Handling errors" section.
// Original: Copyright (c) Sindre Sorhus / execa contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { execa } from 'execa';

export default async () => {
    await describe('execa — error handling', async () => {
        await it('throws when the child exits with non-zero status', async () => {
            let caught: unknown = undefined;
            try {
                await execa('false');
            } catch (err) {
                caught = err;
            }
            // execa attaches the full result shape onto the error object.
            expect(caught).toBeTruthy();
            const e = caught as { exitCode: number; failed: boolean; command: string };
            expect(e.exitCode).toBe(1);
            expect(e.failed).toBe(true);
            expect(e.command).toBe('false');
        });

        await it('does NOT throw with reject:false (returns failure result)', async () => {
            const result = await execa('false', [], { reject: false });
            expect(result.exitCode).toBe(1);
            expect(result.failed).toBe(true);
            // The promise resolves; assertion just confirms no throw.
        });

        await it('throws ENOENT when the executable does not exist', async () => {
            let caught: unknown = undefined;
            try {
                await execa('this-binary-definitely-does-not-exist-gjsify');
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeTruthy();
            const e = caught as { failed: boolean; code?: string; message: string };
            expect(e.failed).toBe(true);
            // The error code surfaces as `code: 'ENOENT'` on Node, and as a
            // wrapped error on GJS via @gjsify/child_process. Assert the
            // message contains the missing binary name to stay portable.
            expect(e.message).toContain('this-binary-definitely-does-not-exist-gjsify');
        });

        await it('captures stderr alongside the throw payload', async () => {
            let caught: unknown = undefined;
            try {
                await execa('node', [
                    '-e',
                    'process.stderr.write("diagnostic"); process.exit(2);',
                ]);
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeTruthy();
            const e = caught as { exitCode: number; stderr: string };
            expect(e.exitCode).toBe(2);
            expect(e.stderr).toContain('diagnostic');
        });
    });
};
