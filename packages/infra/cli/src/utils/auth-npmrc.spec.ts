// `gjsify login` / `gjsify logout` npmrc token writer.
//
// Verifies the nerf-dart key derivation + the upsert/remove behaviour against a
// temp `.npmrc` (pointed at via NPM_CONFIG_USERCONFIG so no real ~/.npmrc is
// touched). No network — pure file manipulation.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nerfDart, authTokenKey, writeAuthToken, removeAuthToken } from './auth-npmrc.js';

const REG = 'https://registry.npmjs.org/';

function withTempNpmrc(initial: string | null, fn: (path: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-authrc-'));
    const path = join(dir, '.npmrc');
    if (initial !== null) writeFileSync(path, initial);
    const prev = process.env.NPM_CONFIG_USERCONFIG;
    process.env.NPM_CONFIG_USERCONFIG = path;
    try {
        fn(path);
    } finally {
        if (prev === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
        else process.env.NPM_CONFIG_USERCONFIG = prev;
    }
}

export default async (): Promise<void> => {
    await describe('auth-npmrc', async () => {
        await it('derives the nerf-dart key like npm', () => {
            expect(nerfDart(REG)).toBe('//registry.npmjs.org/');
            expect(nerfDart('https://npm.pkg.github.com')).toBe('//npm.pkg.github.com/');
            expect(authTokenKey(REG)).toBe('//registry.npmjs.org/:_authToken');
        });

        await it('replaces an existing token, preserves other lines, single trailing newline', () => {
            withTempNpmrc(
                '@gjsify:registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=OLD\n',
                (path) => {
                    writeAuthToken(REG, 'npm_NEW');
                    const out = readFileSync(path, 'utf-8');
                    expect(out).toContain('@gjsify:registry=https://registry.npmjs.org/');
                    expect(out).toContain('//registry.npmjs.org/:_authToken=npm_NEW');
                    expect(out).not.toContain('OLD');
                    // exactly one trailing newline (no accumulated blank lines)
                    expect(out.endsWith('npm_NEW\n')).toBe(true);
                },
            );
        });

        await it('appends a token when none exists yet (and creates the file)', () => {
            withTempNpmrc(null, (path) => {
                expect(existsSync(path)).toBe(false);
                writeAuthToken(REG, 'npm_FRESH');
                const out = readFileSync(path, 'utf-8');
                expect(out).toBe('//registry.npmjs.org/:_authToken=npm_FRESH\n');
            });
        });

        await it('removes the token line, reports removed, keeps the rest', () => {
            withTempNpmrc(
                '@gjsify:registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=TOK\n',
                () => {
                    const r = removeAuthToken(REG);
                    expect(r.removed).toBe(true);
                    const out = readFileSync(r.path, 'utf-8');
                    expect(out).toContain('@gjsify:registry=');
                    expect(out).not.toContain('_authToken');
                },
            );
        });

        await it('remove is a no-op (removed=false) when no token line is present', () => {
            withTempNpmrc('@gjsify:registry=https://registry.npmjs.org/\n', () => {
                expect(removeAuthToken(REG).removed).toBe(false);
            });
        });
    });
};
