// E2E test for `gjsify pack` GLOB expansion in the `files` field.
//
// Regression guard for the v0.4.37–0.4.39 `@gjsify/tsc` "empty lib/" incident:
// the packer (`packages/infra/cli/src/commands/pack.ts`) treated every `files`
// entry as a LITERAL file/dir and never expanded globs, so a `files` entry like
// `lib/lib*.d.ts` matched ZERO files and shipped an empty `lib/` — while a
// plain-directory entry (`files: ["lib"]`) worked. `npm pack` expands the glob;
// `gjsify publish` silently did not. That single asymmetry shipped a broken
// `@gjsify/tsc` (TS6053: lib.esnext.d.ts not found) on every consumer.
//
// This test packs a fixture whose `files` mixes a glob, a plain dir, and a
// literal file, then asserts the produced tarball contains exactly the right
// set — proving `*` matches within a path segment but not across `/`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/publish-files-glob/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

describe('gjsify pack — files glob expansion', () => {
    let dir;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-files-glob-'));
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'files-glob-fixture',
                    version: '1.0.0',
                    // A glob, a plain directory, and a literal file.
                    files: ['lib/lib*.d.ts', 'dist', 'README.md'],
                },
                null,
                2,
            ),
        );
        writeFileSync(join(dir, 'README.md'), '# fixture\n');
        mkdirSync(join(dir, 'lib', 'sub'), { recursive: true });
        // Should be MATCHED by `lib/lib*.d.ts`:
        writeFileSync(join(dir, 'lib', 'lib.esnext.d.ts'), 'export {};\n');
        writeFileSync(join(dir, 'lib', 'lib.dom.d.ts'), 'export {};\n');
        // Should NOT match (basename doesn't start with `lib`):
        writeFileSync(join(dir, 'lib', 'other.d.ts'), 'export {};\n');
        // Should NOT match (wrong extension):
        writeFileSync(join(dir, 'lib', 'lib.notes.txt'), 'notes\n');
        // Should NOT match (`*` does not cross `/`):
        writeFileSync(join(dir, 'lib', 'sub', 'lib.nested.d.ts'), 'export {};\n');
        // Plain-dir entry `dist` includes everything under it:
        mkdirSync(join(dir, 'dist'), { recursive: true });
        writeFileSync(join(dir, 'dist', 'index.js'), 'export {};\n');
    });

    after(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('packs glob-matched files, the plain dir, and the literal — and nothing else', () => {
        execFileSync('node', [CLI_ENTRY, 'pack'], { cwd: dir, encoding: 'utf-8' });
        const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
        assert.ok(tgz, 'pack produced a .tgz');
        const entries = execFileSync('tar', ['tzf', join(dir, tgz)], { encoding: 'utf-8' })
            .split('\n')
            .filter(Boolean)
            .map((e) => e.replace(/^package\//, ''));

        // Glob `lib/lib*.d.ts` → the two lib.*.d.ts at lib/ depth, NOT others.
        assert.ok(entries.includes('lib/lib.esnext.d.ts'), 'lib.esnext.d.ts matched by glob');
        assert.ok(entries.includes('lib/lib.dom.d.ts'), 'lib.dom.d.ts matched by glob');
        assert.ok(!entries.includes('lib/other.d.ts'), 'other.d.ts NOT matched (no lib prefix)');
        assert.ok(!entries.includes('lib/lib.notes.txt'), 'lib.notes.txt NOT matched (wrong ext)');
        assert.ok(
            !entries.includes('lib/sub/lib.nested.d.ts'),
            'nested NOT matched (* does not cross /)',
        );
        // Plain dir + literal still work.
        assert.ok(entries.includes('dist/index.js'), 'plain dir entry includes contents');
        assert.ok(entries.includes('README.md'), 'literal file entry');
        assert.ok(entries.includes('package.json'), 'package.json always included');
    });
});
