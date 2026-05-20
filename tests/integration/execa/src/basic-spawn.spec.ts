// SPDX-License-Identifier: MIT
// Inspired by node_modules/execa/index.d.ts + the public README "Quick
// start" section. The published execa tarball does not ship its full
// test fixtures, so this is a re-derivation against the documented
// public API.
// Original: Copyright (c) Sindre Sorhus / execa contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { execa } from 'execa';

export default async () => {
    await describe('execa — basic spawn', async () => {
        await it('resolves with { stdout, exitCode } on success', async () => {
            const result = await execa('echo', ['hello, gjsify']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('hello, gjsify');
            expect(result.failed).toBe(false);
            // execa v9 joins args with single spaces; no shell-quoting is
            // applied. Stay loose so the assertion survives across minor
            // releases.
            expect(result.command.startsWith('echo ')).toBe(true);
            expect(result.command).toContain('hello, gjsify');
        });

        await it('preserves multi-line stdout', async () => {
            // `printf` is POSIX-portable for multi-line output.
            const result = await execa('printf', ['%s\\n%s\\n', 'line1', 'line2']);
            expect(result.exitCode).toBe(0);
            // `result.stdout` strips the trailing newline by default but
            // keeps internal line breaks.
            expect(result.stdout).toBe('line1\nline2');
        });

        await it('forwards argv with embedded spaces (no shell interpretation)', async () => {
            // The argv array is passed verbatim — execa does NOT spawn a
            // shell unless { shell: true } is set. Spaces inside an
            // element are part of that arg, not a separator.
            const result = await execa('echo', ['one two three']);
            expect(result.stdout).toBe('one two three');
        });

        await it('reports the spawned command for diagnostics', async () => {
            const result = await execa('node', ['-e', 'process.stdout.write("ok")']);
            expect(result.stdout).toBe('ok');
            // execa's `command` field re-quotes args that contain spaces or
            // shell metacharacters, suitable for human-readable logs.
            expect(result.command.startsWith('node')).toBe(true);
            expect(result.command).toContain('process.stdout.write');
        });

        await it('respects the cwd option', async () => {
            const result = await execa('pwd', [], { cwd: '/tmp' });
            // resolve() any /private/ prefix some macOS systems prepend.
            // Our CI is Linux so a direct compare works.
            expect(result.stdout.endsWith('/tmp')).toBe(true);
        });

        await it('exposes the child process via .pid', async () => {
            const child = execa('sleep', ['0.05']);
            expect(typeof child.pid).toBe('number');
            const result = await child;
            expect(result.exitCode).toBe(0);
        });
    });
};
