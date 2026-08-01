// E2E test for the `gjsify pack` type-declaration shipping guard.
//
// Regression guard for issue #655: the Phase D.7d (#179) mass-add of
// `files: ["lib"]` to 79 packages silently stripped the two packages whose
// `exports`/`types` referenced a type-declaration file OUTSIDE `lib/` —
// `@gjsify/vite-plugin-blueprint` (`./types/blueprint.d.ts`) and
// `@gjsify/adwaita-fonts` (`./index.d.ts`). The runtime entry still shipped, so
// the break was invisible until a TypeScript consumer hit TS2307 / implicit any.
//
// The packer now HARD-FAILS when a `types`/`typings` declaration that physically
// exists on disk is excluded from the tarball by the `files` allowlist. This
// test proves: (a) the mismatch throws with an actionable message, (b) adding
// the path to `files` makes it pack AND ship, (c) the top-level `types` field is
// covered too, and (d) an unbuilt/absent types path does NOT false-positive.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/publish-types-shipped/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

/** Pack a fixture dir; return { ok, stderr }. Never throws. */
function tryPack(dir) {
    try {
        execFileSync('node', [CLI_ENTRY, 'pack'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
        return { ok: true, stderr: '' };
    } catch (err) {
        return { ok: false, stderr: String(err.stderr ?? err.message ?? err) };
    }
}

function tarEntries(dir) {
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    assert.ok(tgz, `pack produced a .tgz in ${dir}`);
    return execFileSync('tar', ['tzf', join(dir, tgz)], { encoding: 'utf-8' })
        .split('\n')
        .filter(Boolean)
        .map((e) => e.replace(/^package\//, ''));
}

describe('gjsify pack — type-declaration shipping guard (#655)', () => {
    let tmp;
    before(() => {
        tmp = mkdtempSync(join(tmpdir(), 'gjsify-types-shipped-'));
    });
    after(() => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    // Mirrors the exact @gjsify/vite-plugin-blueprint shape: a `./types` subpath
    // whose `types` condition points at a file OUTSIDE the `files` allowlist.
    it('THROWS when an exports types condition points outside files[]', () => {
        const dir = join(tmp, 'exports-types-broken');
        mkdirSync(join(dir, 'lib'), { recursive: true });
        mkdirSync(join(dir, 'types'), { recursive: true });
        writeFileSync(join(dir, 'lib', 'index.js'), 'export const x = 1;\n');
        writeFileSync(join(dir, 'lib', 'index.d.ts'), 'export const x: number;\n');
        writeFileSync(
            join(dir, 'types', 'blueprint.d.ts'),
            "declare module '*.blp' { const s: string; export default s; }\n",
        );
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'types-broken-fixture',
                    version: '1.0.0',
                    exports: {
                        '.': { types: './lib/index.d.ts', default: './lib/index.js' },
                        './types': { types: './types/blueprint.d.ts' },
                    },
                    files: ['lib'],
                },
                null,
                2,
            ),
        );
        const { ok, stderr } = tryPack(dir);
        assert.equal(ok, false, 'pack must fail on the excluded types file');
        assert.match(stderr, /types\/blueprint\.d\.ts/, 'error names the missing file');
        assert.match(stderr, /files/, 'error points at the files allowlist');
    });

    it('PACKS and ships the types file once added to files[]', () => {
        const dir = join(tmp, 'exports-types-fixed');
        mkdirSync(join(dir, 'lib'), { recursive: true });
        mkdirSync(join(dir, 'types'), { recursive: true });
        writeFileSync(join(dir, 'lib', 'index.js'), 'export const x = 1;\n');
        writeFileSync(join(dir, 'lib', 'index.d.ts'), 'export const x: number;\n');
        writeFileSync(join(dir, 'types', 'blueprint.d.ts'), 'export {};\n');
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'types-fixed-fixture',
                    version: '1.0.0',
                    exports: {
                        '.': { types: './lib/index.d.ts', default: './lib/index.js' },
                        './types': { types: './types/blueprint.d.ts' },
                    },
                    files: ['lib', 'types'],
                },
                null,
                2,
            ),
        );
        const { ok, stderr } = tryPack(dir);
        assert.equal(ok, true, `pack must succeed once types/ is allowlisted:\n${stderr}`);
        const entries = tarEntries(dir);
        assert.ok(entries.includes('types/blueprint.d.ts'), 'types/blueprint.d.ts is shipped');
        assert.ok(entries.includes('lib/index.d.ts'), 'lib/index.d.ts is shipped');
    });

    // Mirrors @gjsify/adwaita-fonts: a top-level `types` field pointing at a
    // root-level .d.ts that a `files: ["*.css"]` glob doesn't cover.
    it('THROWS when the top-level types field points outside files[]', () => {
        const dir = join(tmp, 'toplevel-types-broken');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.css'), 'body{}\n');
        writeFileSync(join(dir, 'index.d.ts'), 'export {};\n');
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'toplevel-types-fixture',
                    version: '1.0.0',
                    main: 'index.css',
                    types: 'index.d.ts',
                    files: ['*.css'],
                },
                null,
                2,
            ),
        );
        const { ok, stderr } = tryPack(dir);
        assert.equal(ok, false, 'pack must fail on the excluded top-level types file');
        assert.match(stderr, /index\.d\.ts/, 'error names the missing top-level types file');
    });

    // A types path that isn't built yet (absent on disk) must NOT false-positive
    // — an unbuilt dev tree packs fine; tsc/the build catches a dangling ref.
    it('does NOT false-positive when the types file is absent on disk', () => {
        const dir = join(tmp, 'types-absent');
        mkdirSync(join(dir, 'lib'), { recursive: true });
        writeFileSync(join(dir, 'lib', 'index.js'), 'export const x = 1;\n');
        // Note: lib/index.d.ts intentionally NOT written (not built yet).
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'types-absent-fixture',
                    version: '1.0.0',
                    exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' } },
                    files: ['lib'],
                },
                null,
                2,
            ),
        );
        const { ok, stderr } = tryPack(dir);
        assert.equal(ok, true, `pack must succeed when the types file isn't on disk yet:\n${stderr}`);
    });
});
