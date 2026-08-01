// E2E test for `gjsify pack` honoring the `files` allowlist OVER .gitignore.
//
// Regression guard for the @gjsify/adwaita-web@0.16.0 "missing
// styles.generated.ts" incident: adwaita-web has `files: ["src", …]` and its
// `src/index.ts` imports `./styles.generated.js`, but `src/styles.generated.ts`
// (a `build:scss` output) is listed in the package's `.gitignore`. The packer
// (`packages/infra/cli/src/commands/pack.ts`) applied the .gitignore filter
// even to paths the `files` field allowlists, so the published tarball shipped
// all of `src/` EXCEPT the gitignored-but-allowlisted `styles.generated.ts` —
// producing a broken package whose `import '@gjsify/adwaita-web'` failed with
// "module not found" for a standalone consumer.
//
// npm semantics: a `files` allowlist OVERRIDES .gitignore/.npmignore — every
// file under an allowlisted path ships from disk; only the hardcoded
// never-pack set (node_modules, .git, lockfiles, …) is dropped. This test
// packs a fixture with `files: ["src"]` + a gitignored `src/generated.ts` and
// asserts the tarball INCLUDES the gitignored-but-allowlisted file while still
// EXCLUDING node_modules.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/pack-gitignored-files/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

describe('gjsify pack — files allowlist overrides .gitignore', () => {
    let dir;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-pack-gitignored-'));
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'pack-gitignored-fixture',
                    version: '1.0.0',
                    files: ['src'],
                },
                null,
                2,
            ),
        );
        // The whole `src/` dir is allowlisted via `files: ["src"]`.
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src', 'index.ts'), `export { gen } from './generated.js';\n`);
        // A build-generated file that is .gitignored but allowlisted by `files`.
        writeFileSync(join(dir, 'src', 'generated.ts'), `export const gen = 1;\n`);
        // .gitignore drops the generated file (and a build dir). npm — and now
        // gjsify — ship it anyway because `files` allowlists `src/`.
        writeFileSync(join(dir, '.gitignore'), `src/generated.ts\nbuild/\n`);
        // node_modules must NEVER ship even when nested under an allowlisted dir.
        mkdirSync(join(dir, 'src', 'node_modules', 'junk'), { recursive: true });
        writeFileSync(join(dir, 'src', 'node_modules', 'junk', 'index.js'), `module.exports = {};\n`);
    });

    after(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('includes the gitignored-but-allowlisted file and excludes node_modules', () => {
        execFileSync('node', [CLI_ENTRY, 'pack'], { cwd: dir, encoding: 'utf-8' });
        const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
        assert.ok(tgz, 'pack produced a .tgz');
        const entries = execFileSync('tar', ['tzf', join(dir, tgz)], { encoding: 'utf-8' })
            .split('\n')
            .filter(Boolean)
            .map((e) => e.replace(/^package\//, ''));

        // The gitignored-but-allowlisted file MUST ship (the actual bug).
        assert.ok(
            entries.includes('src/generated.ts'),
            'gitignored-but-files-allowlisted src/generated.ts must be packed',
        );
        // Its sibling (not ignored) still ships.
        assert.ok(entries.includes('src/index.ts'), 'src/index.ts must be packed');
        assert.ok(entries.includes('package.json'), 'package.json always included');
        // node_modules must NEVER ship, even nested under an allowlisted dir.
        assert.ok(!entries.some((e) => e.includes('node_modules')), 'node_modules must be excluded from the tarball');
    });
});
