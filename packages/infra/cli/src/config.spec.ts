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

/**
 * Resolve a build config for a `--dialect` / `--app` pair, or return the message
 * it was refused with. The fixture is the same throwaway shape as above.
 */
async function resolveDialect(
    pkgGjsify: Record<string, unknown>,
    cliArgs: Partial<CliBuildOptions>,
): Promise<{ dialect?: string; app?: string; error?: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-config-dialect-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '0.0.0', type: 'module', gjsify: pkgGjsify }),
    );
    const prevCwd = process.cwd();
    try {
        process.chdir(dir);
        const data = await new Config().forBuild(cliArgs as ArgumentsCamelCase<CliBuildOptions>);
        return { dialect: data.dialect, app: data.app };
    } catch (error) {
        return { error: (error as Error).message };
    } finally {
        process.chdir(prevCwd);
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

    await describe('Config.forBuild — the dialect must reach a target that composes it', async () => {
        await it('accepts --dialect react-native on the two targets that compose it', async () => {
            for (const app of ['gjs', 'node']) {
                const resolved = await resolveDialect({}, { dialect: 'react-native', app } as Partial<CliBuildOptions>);
                expect(resolved.error).toBeUndefined();
                expect(resolved.dialect).toBe('react-native');
            }
        });

        await it('REFUSES a dialect on a target that composes nothing', async () => {
            // The failure this guards is silence, not a crash: only `app/gjs.ts` and
            // `app/node.ts` compose the dialect plugins, so on any other target the
            // alias never happens and the support gate never runs — and the build
            // still succeeds, having done none of what was asked. yargs `choices`
            // cannot catch it; the pair is only wrong together.
            for (const app of ['browser', 'nativescript']) {
                const resolved = await resolveDialect({}, { dialect: 'react-native', app } as Partial<CliBuildOptions>);
                expect(resolved.error ?? '').toContain('has no effect on --app');
                expect(resolved.error ?? '').toContain(app);
            }
        });

        await it('refuses the same pair when the dialect came from the config file', async () => {
            // `gjsify.dialect` never passes through yargs, which is why the check
            // lives in Config rather than in the command definition.
            const resolved = await resolveDialect({ dialect: 'react-native' }, {
                app: 'browser',
            } as Partial<CliBuildOptions>);
            expect(resolved.error ?? '').toContain('has no effect on --app browser');
        });

        await it('says nothing about a build that asked for no dialect', async () => {
            const resolved = await resolveDialect({}, { app: 'browser' } as Partial<CliBuildOptions>);
            expect(resolved.error).toBeUndefined();
            expect(resolved.dialect).toBeUndefined();
        });
    });
};
