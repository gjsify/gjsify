// E2E guard for `gjsify flatpak sources` — turning a gjsify-lock.json into an
// offline flatpak-builder `sources` array. The emitted `dest` / `dest-filename`
// MUST match the cache layout `install-tarball-cache.ts` reads from
// ($XDG_CACHE_HOME/gjsify/tarballs/v1/<algo>/<hex[0:2]>/<full-hex>.tgz), or an
// offline `gjsify install --immutable` in the Flatpak sandbox can't find the
// vendored tarballs. The test is self-validating: it derives the expected hex
// from the same SHA-512 digest it puts in the fixture lockfile.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

/** A valid `sha512-<base64>` SRI for `content`, plus its hex digest. */
function sri(content) {
    return {
        integrity: `sha512-${createHash('sha512').update(content).digest('base64')}`,
        hex: createHash('sha512').update(content).digest('hex'),
    };
}

describe('gjsify flatpak sources', () => {
    let dir;
    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-flatpak-sources-'));
    });
    after(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('emits deduped flatpak file sources mapping to the gjsify tarball cache', () => {
        const a = sri('pkg-a');
        const b = sri('pkg-b');
        const lock = {
            lockfileVersion: 2,
            packages: {
                'node_modules/a': {
                    version: '1.0.0',
                    resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
                    integrity: a.integrity,
                },
                // same integrity at a nested path → must dedupe to ONE source.
                'node_modules/x/node_modules/a': {
                    version: '1.0.0',
                    resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
                    integrity: a.integrity,
                },
                'node_modules/b': {
                    version: '2.0.0',
                    resolved: 'https://registry.npmjs.org/b/-/b-2.0.0.tgz',
                    integrity: b.integrity,
                },
                // root/workspace entry — no registry tarball, must be skipped.
                '': { version: '0.0.0' },
            },
        };
        const lockPath = join(dir, 'gjsify-lock.json');
        writeFileSync(lockPath, JSON.stringify(lock));
        const out = join(dir, 'sources.json');

        execFileSync(
            'node',
            [CLI_ENTRY, 'flatpak', 'sources', '--lockfile', lockPath, '--out', out, '--cache-root', 'mycache'],
            { cwd: dir, stdio: 'pipe' },
        );

        const sources = JSON.parse(readFileSync(out, 'utf-8'));
        assert.equal(sources.length, 2, `expected pkg-a deduped → 2 sources, got ${sources.length}`);

        for (const s of sources) {
            assert.equal(s.type, 'file');
            assert.match(s.url, /registry\.npmjs\.org/);
        }

        const sa = sources.find((s) => s.url.includes('/a-1.0.0'));
        assert.ok(sa, 'source for package "a" present');
        // sha512 field is the base64→hex of the lockfile SRI.
        assert.equal(sa.sha512, a.hex, 'sha512 must be base64→hex of the SRI');
        // dest-filename + dest reproduce install-tarball-cache.ts pathFor().
        assert.equal(sa['dest-filename'], `${a.hex}.tgz`);
        assert.equal(sa.dest, `mycache/gjsify/tarballs/v1/sha512/${a.hex.slice(0, 2)}`);
    });

    /** Write a fixture lockfile, run the generator, return the parsed sources. */
    function runOn(filename, content) {
        const lockPath = join(dir, filename);
        writeFileSync(lockPath, content);
        const out = join(dir, `${filename}.sources.json`);
        execFileSync('node', [CLI_ENTRY, 'flatpak', 'sources', '--lockfile', lockPath, '--out', out], {
            cwd: dir,
            stdio: 'pipe',
        });
        return JSON.parse(readFileSync(out, 'utf-8'));
    }

    it('parses an npm package-lock.json (packages shape)', () => {
        const n = sri('npm-pkg');
        const sources = runOn(
            'package-lock.json',
            JSON.stringify({
                lockfileVersion: 3,
                packages: {
                    '': { name: 'app', version: '1.0.0' },
                    'node_modules/n': {
                        version: '1.0.0',
                        resolved: 'https://registry.npmjs.org/n/-/n-1.0.0.tgz',
                        integrity: n.integrity,
                    },
                },
            }),
        );
        assert.equal(sources.length, 1);
        assert.equal(sources[0].sha512, n.hex);
        assert.equal(sources[0].url, 'https://registry.npmjs.org/n/-/n-1.0.0.tgz');
    });

    it('parses a classic yarn.lock (resolved + integrity, strips the #sha1)', () => {
        const y = sri('yarn-pkg');
        const sources = runOn(
            'yarn.lock',
            ['y@^1.0.0:', '  version "1.0.0"', '  resolved "https://registry.yarnpkg.com/y/-/y-1.0.0.tgz#deadbeef"', `  integrity ${y.integrity}`, ''].join(
                '\n',
            ),
        );
        assert.equal(sources.length, 1);
        assert.equal(sources[0].sha512, y.hex);
        assert.equal(sources[0].url, 'https://registry.yarnpkg.com/y/-/y-1.0.0.tgz', 'the #sha1 fragment is stripped');
    });

    it('parses a pnpm-lock.yaml (reconstructs the registry tarball URL, scoped + plain)', () => {
        const p = sri('pnpm-scoped');
        const q = sri('pnpm-plain');
        const sources = runOn(
            'pnpm-lock.yaml',
            [
                "lockfileVersion: '9.0'",
                'packages:',
                "  '@scope/p@1.2.3':",
                `    resolution: {integrity: ${p.integrity}}`,
                '  q@2.0.0:',
                `    resolution: {integrity: ${q.integrity}}`,
                '',
            ].join('\n'),
        );
        assert.equal(sources.length, 2);
        const sp = sources.find((s) => s.url.includes('/@scope/p/'));
        assert.ok(sp, 'scoped package source present');
        assert.equal(sp.url, 'https://registry.npmjs.org/@scope/p/-/p-1.2.3.tgz');
        assert.equal(sp.sha512, p.hex);
        const sq = sources.find((s) => s.url.includes('/q/'));
        assert.equal(sq.url, 'https://registry.npmjs.org/q/-/q-2.0.0.tgz');
    });

    it('rejects a Yarn Berry (v2+) lockfile with a clear message', () => {
        let threw = false;
        try {
            runOn('yarn.lock', ['__metadata:', '  version: 8', '"pkg@npm:1.0.0":', '  checksum: 10c0/abc', ''].join('\n'));
        } catch (err) {
            threw = true;
            assert.match(`${err.stderr ?? ''}${err.stdout ?? ''}`, /Yarn Berry/i);
        }
        assert.ok(threw, 'expected a non-zero exit on a Yarn Berry lockfile');
    });

    it('fails clearly when the lockfile is missing', () => {
        let threw = false;
        try {
            execFileSync('node', [CLI_ENTRY, 'flatpak', 'sources', '--lockfile', join(dir, 'nope.json')], {
                cwd: dir,
                stdio: 'pipe',
            });
        } catch (err) {
            threw = true;
            assert.match(`${err.stderr ?? ''}${err.stdout ?? ''}`, /not found/i);
        }
        assert.ok(threw, 'expected a non-zero exit on a missing lockfile');
    });
});
