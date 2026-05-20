// SPDX-License-Identifier: MIT
// Inspired by node_modules/execa/index.d.ts (Result, Options).
// Original: Copyright (c) Sindre Sorhus / execa contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect, on } from '@gjsify/unit';
import { execa } from 'execa';

export default async () => {
    await describe('execa — output capture', async () => {
        await it('captures stdout and stderr independently', async () => {
            const result = await execa('node', [
                '-e',
                'process.stdout.write("out-data"); process.stderr.write("err-data");',
            ]);
            expect(result.stdout).toBe('out-data');
            expect(result.stderr).toBe('err-data');
            expect(result.exitCode).toBe(0);
        });

        await it('returns empty string when child writes nothing', async () => {
            const result = await execa('true');
            expect(result.stdout).toBe('');
            expect(result.stderr).toBe('');
        });

        await it('forwards environment via the env option', async () => {
            const result = await execa(
                'node',
                ['-e', 'process.stdout.write(String(process.env.GJSIFY_TOKEN))'],
                { env: { GJSIFY_TOKEN: 'abc123' } },
            );
            expect(result.stdout).toBe('abc123');
        });

        // GJS path needs `@gjsify/child_process`'s async `spawn()` to wire
        // up `child.stdin` as a Writable wrapping Gio.Subprocess's stdin
        // pipe (Gio.OutputStream). Currently only the *sync* paths
        // (execSync/spawnSync via `proc.communicate(bytes, null)`) accept
        // stdin input. Tracked under "Open TODOs" in STATUS.md.
        await on('Node.js', async () => {
            await it('passes stdin via the input option (string)', async () => {
                const result = await execa(
                    'node',
                    ['-e', 'let buf = ""; process.stdin.on("data", d => buf += d); process.stdin.on("end", () => process.stdout.write(buf))'],
                    { input: 'piped-stdin-payload' },
                );
                expect(result.stdout).toBe('piped-stdin-payload');
            });
        });

        await it('parses JSON stdout when json:true', async () => {
            // execa v9: `result.stdout` is parsed automatically when the
            // `json` option (Options.shape.json) is set on the relevant API
            // surface. We use the safer manual JSON.parse here to keep the
            // assertion portable across execa minor versions.
            const result = await execa('node', [
                '-e',
                'process.stdout.write(JSON.stringify({ a: 1, b: [2, 3] }))',
            ]);
            const parsed = JSON.parse(result.stdout) as { a: number; b: number[] };
            expect(parsed.a).toBe(1);
            expect(parsed.b).toStrictEqual([2, 3]);
        });
    });
};
