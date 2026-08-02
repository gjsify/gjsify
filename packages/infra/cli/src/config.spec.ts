// Coverage for `Config.forBuild` option precedence — specifically that
// `--globals` resolves CLI flag > config file > 'auto'. Regression guard for
// the bug where the yargs `default: 'auto'` always clobbered
// `package.json#gjsify.globals` (making the config field a silent no-op).
//
// Node-only: drives a real on-disk fixture via `process.chdir` (the CLI's
// test harness is `test:node`). The precedence logic is host-agnostic.

import { describe, it, expect } from '@gjsify/unit';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from './config.js';
import type { CliBuildOptions } from './types/index.js';
import type { ArgumentsCamelCase } from 'yargs';

/**
 * Resolve `configData.globals` for a given `package.json#gjsify` block and a
 * set of CLI args, against a throwaway fixture directory.
 */
async function resolveGlobals(
    pkgGjsify: Record<string, unknown>,
    cliArgs: Partial<CliBuildOptions>,
): Promise<string | undefined> {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-config-globals-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '0.0.0', type: 'module', gjsify: pkgGjsify }),
    );
    const prevCwd = process.cwd();
    try {
        process.chdir(dir);
        const config = new Config();
        const data = await config.forBuild(cliArgs as ArgumentsCamelCase<CliBuildOptions>);
        return data.globals;
    } finally {
        process.chdir(prevCwd);
        // `maxRetries` is for Windows, and this row is why: observed here as
        // `EPERM … rmSync` on the fixture directory, on a run where the same
        // assertion had passed minutes before. Windows refuses to remove a
        // directory while any handle into it is still open, and a handle can
        // outlive the read that opened it by a few milliseconds (a scanner, an
        // indexer, or the config loader that just parsed this fixture's
        // package.json). The `chdir` back above is necessary but not
        // sufficient. Same mitigation `commands/clear.ts` and
        // `commands/install.ts` already apply, for the same reason.
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
}

export default async () => {
    await describe('Config.forBuild — globals precedence', async () => {
        await it("defaults to 'auto' when neither config nor CLI set it", async () => {
            expect(await resolveGlobals({}, {})).toBe('auto');
        });

        await it('uses package.json#gjsify.globals when no CLI flag is passed', async () => {
            // The bug: a yargs `default: 'auto'` made this resolve to 'auto'.
            expect(await resolveGlobals({ globals: 'node' }, {})).toBe('node');
        });

        await it('lets an explicit CLI --globals win over the config file', async () => {
            expect(await resolveGlobals({ globals: 'node' }, { globals: 'web' })).toBe('web');
        });

        await it('honours an explicit CLI --globals with no config value', async () => {
            expect(await resolveGlobals({}, { globals: 'none' })).toBe('none');
        });
    });
};
