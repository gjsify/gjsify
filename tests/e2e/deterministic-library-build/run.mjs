// E2E: `gjsify build --library` output is a pure function of the SOURCE TREE —
// independent of filesystem traversal order and of when sibling directories
// finish being scanned.
//
// Why this exists: entry ORDER is an input to the emitted bytes. Rolldown
// derives every module's and external's exec order from a DFS that starts at
// the entries IN ORDER, and each emitted chunk renders its import statements
// sorted by that exec order — NOT by the module's own source order. Library
// builds expand `src/**/*.ts` through `globToEntryPoints`, and fast-glob's
// concurrent walker used to hand back matches in COMPLETION order (sibling
// directories race; measured 9 distinct orderings in 60 runs on one machine).
// A minority ordering emits `lib/esm/*.js` with swapped import statements, the
// committed app bundles (`dist/*.gjs.mjs`) inline those libs, and
// `scripts/verify-committed-bundles.mjs` then fails with the
// `system`/`gi://GioUnix` hoisted-import swap that could not be reproduced on
// the machine that committed the bundle.
//
// The fixture makes the failure deterministic rather than probabilistic: its
// SORTED entry order starts inside a subdirectory (`src/aa/first.ts`), while a
// walker's natural order starts with the parent directory's own files
// (`src/both.ts`). The two orders first-touch the externals `ext-a` / `ext-b`
// in opposite sequence, so the rendered import order of `lib/esm/both.js`
// differs — byte-visibly — whenever the entry order is not the canonical
// sorted one.
//
// Asserts:
//   1. the glob build equals the build from an EXPLICIT sorted entry list —
//      glob expansion is canonicalized, not walker-ordered;
//   2. repeated glob builds are byte-identical (run-to-run determinism);
//   3. the canonical import order is visible in `both.js` (`ext-a` first —
//      the sorted DFS first-touches it via `src/aa/first.ts`).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

/** sha256 over the sorted (path, content) sequence of a directory tree. */
function hashTree(dir) {
    const files = [];
    (function walk(d) {
        for (const name of readdirSync(d).sort()) {
            const p = join(d, name);
            if (readdirSyncSafe(p) !== null) walk(p);
            else files.push(p);
        }
    })(dir);
    const h = createHash('sha256');
    for (const f of files.sort()) {
        h.update(f.slice(dir.length));
        h.update('\0');
        h.update(readFileSync(f));
    }
    return h.digest('hex');
}

function readdirSyncSafe(p) {
    try {
        return readdirSync(p);
    } catch {
        return null;
    }
}

describe('deterministic library build (entry-order canonicalization)', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;

    const SORTED_ENTRIES = ['src/aa/first.ts', 'src/both.ts', 'src/shared.ts', 'src/zz.ts'];

    function build(entries) {
        rmSync(join(projectDir, 'lib'), { recursive: true, force: true });
        execFileSync(
            process.execPath,
            [CLI_ENTRY, 'build', '--library', 'esm', ...entries, '--external', 'ext-a', '--external', 'ext-b'],
            { cwd: projectDir, stdio: 'pipe', timeout: 5 * 60 * 1000 },
        );
        const esmDir = join(projectDir, 'lib', 'esm');
        assert.ok(existsSync(join(esmDir, 'both.js')), 'library build must emit lib/esm/both.js');
        return hashTree(esmDir);
    }

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-deterministic-lib-'));
        projectDir = join(tmpDir, 'project');
        mkdirSync(join(projectDir, 'src', 'aa'), { recursive: true });

        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'test-deterministic-library-build',
                    version: '0.1.0',
                    type: 'module',
                    private: true,
                    module: 'lib/esm/index.js',
                },
                null,
                4,
            ),
        );
        // `both.ts` imports ext-b BEFORE ext-a in SOURCE order. Its rendered
        // import order follows the externals' global exec order instead:
        //   - sorted entries: src/aa/first.ts runs first → ext-a first.
        //   - walker order (parent files first): src/both.ts runs first →
        //     ext-b first.
        writeFileSync(
            join(projectDir, 'src', 'both.ts'),
            "import extB from 'ext-b';\nimport extA from 'ext-a';\nimport { shared } from './shared.js';\n" +
                'export const both = [extA, extB, shared];\n',
        );
        writeFileSync(
            join(projectDir, 'src', 'aa', 'first.ts'),
            "import extA from 'ext-a';\nimport { shared } from '../shared.js';\nexport const first = [extA, shared];\n",
        );
        writeFileSync(join(projectDir, 'src', 'zz.ts'), "import extB from 'ext-b';\nexport const zz = [extB];\n");
        writeFileSync(join(projectDir, 'src', 'shared.ts'), 'export const shared = 1;\n');
    });

    after(() => {
        if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('glob build equals the explicit sorted-entry build, byte for byte', () => {
        const fromGlob = build(['src/**/*.ts']);
        const fromSortedList = build(SORTED_ENTRIES);
        assert.equal(
            fromGlob,
            fromSortedList,
            'glob expansion must be canonicalized (sorted) — a walker-ordered entry list emits different bytes',
        );
    });

    it('repeated glob builds are byte-identical', () => {
        const first = build(['src/**/*.ts']);
        for (let i = 0; i < 2; i++) {
            assert.equal(build(['src/**/*.ts']), first, `glob build #${i + 2} diverged from the first`);
        }
    });

    it('renders the canonical (sorted-DFS) external import order in both.js', () => {
        build(['src/**/*.ts']);
        const both = readFileSync(join(projectDir, 'lib', 'esm', 'both.js'), 'utf-8');
        const posA = both.indexOf('ext-a');
        const posB = both.indexOf('ext-b');
        assert.ok(posA >= 0 && posB >= 0, 'both.js must import both externals');
        assert.ok(
            posA < posB,
            `ext-a must precede ext-b (sorted DFS first-touches it via src/aa/first.ts); got:\n${both.slice(0, 300)}`,
        );
    });
});
