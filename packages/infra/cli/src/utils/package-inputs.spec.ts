// SPDX-License-Identifier: MIT
// The ONE definition of "what are this package's build inputs" (#1651).
//
// Every case here is one of the two arms a freshness test needs, and the
// NEGATIVE arm is the one worth keeping: without it the whole suite passes
// against an input set that simply contains everything — which is not a fix,
// it is the cache switched off.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    CONVENTIONAL_OUTPUT_DIRS,
    newestInputMtimeMs,
    packageBuildInputs,
    packageOutputPaths,
} from './package-inputs.js';

/** A package tree on disk; `paths` are package-relative, `/`-separated. */
function fixture(manifest: Record<string, unknown>, paths: readonly string[]): { root: string } {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-pkg-inputs-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2));
    for (const rel of paths) {
        const abs = join(root, ...rel.split('/'));
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, `// ${rel}\n`);
    }
    return { root };
}

function relsOf(root: string, options?: Parameters<typeof packageBuildInputs>[1]): string[] {
    return packageBuildInputs(root, options)
        .map((file) => file.rel)
        .sort();
}

export default async () => {
    await describe('packageOutputPaths', async () => {
        await it('reads the targets off a `gjsify clear` script', async () => {
            const outputs = packageOutputPaths({
                scripts: { clear: 'gjsify clear lib tmp tsconfig.tsbuildinfo src/icons.generated.ts' },
            });
            expect(outputs).toContain('tmp');
            expect(outputs).toContain('src/icons.generated.ts');
            // The conventional dirs are unioned on: `gjsify test` writes
            // `dist/test.node.mjs` into packages whose `clear` line predates it.
            for (const dir of CONVENTIONAL_OUTPUT_DIRS) expect(outputs).toContain(dir);
        });

        await it('treats a no-op `clear` script as "this package produces nothing"', async () => {
            // @gjsify/resolve-npm + @gjsify/manifest-conformance: `lib/` holds
            // TRACKED SOURCE (6 and 26 files) and their `clear` says so. Reading
            // the conventional list here instead is what kept `resolve-npm/lib`
            // — which `cli.gjs.mjs` inlines — out of every cache key (#821).
            expect(packageOutputPaths({ scripts: { clear: "echo 'nothing to do'" } })).toStrictEqual([]);
        });

        await it('falls back to the conventional dirs when nothing is declared', async () => {
            expect(packageOutputPaths({ scripts: {} })).toStrictEqual([...CONVENTIONAL_OUTPUT_DIRS]);
            expect(packageOutputPaths(null)).toStrictEqual([...CONVENTIONAL_OUTPUT_DIRS]);
        });
    });

    await describe('packageBuildInputs', async () => {
        await it('covers src/ AND tests/ — the halves the two old copies each missed', async () => {
            const { root } = fixture({ name: 'f' }, ['src/lib.ts', 'tests/test.mts', 'README.md']);
            try {
                expect(relsOf(root)).toStrictEqual(['README.md', 'package.json', 'src/lib.ts', 'tests/test.mts']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('covers a package with no src/ at all', async () => {
            // @gjsify/adwaita-fonts: its build reads `scripts/build-embedded.mjs`
            // and `files/*.ttf`, and an allow-list over `src/**` sees neither.
            const { root } = fixture({ name: 'f', scripts: { clear: 'gjsify clear lib' } }, [
                'scripts/build-embedded.mjs',
                'files/AdwaitaSans.ttf',
            ]);
            try {
                expect(relsOf(root)).toStrictEqual([
                    'files/AdwaitaSans.ttf',
                    'package.json',
                    'scripts/build-embedded.mjs',
                ]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('excludes what the package declares it produces, including inside src/', async () => {
            const { root } = fixture(
                { name: 'f', scripts: { clear: 'gjsify clear lib *.tsbuildinfo src/icons.generated.ts' } },
                [
                    'src/index.ts',
                    'src/icons.generated.ts',
                    'lib/esm/index.js',
                    'dist/test.node.mjs',
                    'tsconfig.tsbuildinfo',
                ],
            );
            try {
                expect(relsOf(root)).toStrictEqual(['package.json', 'src/index.ts']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('keeps a tracked lib/ when the package declares no output', async () => {
            const { root } = fixture({ name: 'f', scripts: { clear: "echo 'nothing to do'" } }, ['lib/index.mjs']);
            try {
                expect(relsOf(root)).toStrictEqual(['lib/index.mjs', 'package.json']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('excludes node_modules at any depth and every dot-entry', async () => {
            const { root } = fixture({ name: 'f' }, [
                'src/index.ts',
                'node_modules/dep/index.js',
                'src/node_modules/nested/index.js',
                '.git/HEAD',
                'src/.cache/blob',
            ]);
            try {
                expect(relsOf(root)).toStrictEqual(['package.json', 'src/index.ts']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('records a directory symlink by target instead of following it', async () => {
            const { root } = fixture({ name: 'f' }, ['src/index.ts']);
            try {
                symlinkSync(join(root, 'src'), join(root, 'linked'), 'dir');
                const linked = packageBuildInputs(root).find((file) => file.rel === 'linked');
                expect(linked).toBeDefined();
                expect(linked?.link).toContain('src');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('subtracts an extra output the caller names (`gjsify test --outdir`)', async () => {
            const { root } = fixture({ name: 'f' }, ['src/index.ts', 'build/test.node.mjs']);
            try {
                expect(relsOf(root)).toContain('build/test.node.mjs');
                expect(relsOf(root, { extraOutputs: ['build'] })).toStrictEqual(['package.json', 'src/index.ts']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('newestInputMtimeMs', async () => {
        await it('rises when an input changes and not when an excluded file does', async () => {
            const { root } = fixture({ name: 'f' }, ['src/lib.ts', 'tests/test.mts']);
            try {
                const before = newestInputMtimeMs(packageBuildInputs(root));

                // POSITIVE: the code under test moves the watermark. This is
                // the assertion #1651 fails — `dirname(<test entry>)` is
                // `tests/`, so `src/lib.ts` was never in the set at all.
                const future = Date.now() + 10_000;
                writeFileSync(join(root, 'src', 'lib.ts'), '// touched\n');
                utimesSync(join(root, 'src', 'lib.ts'), future / 1000, future / 1000);
                const afterSrc = newestInputMtimeMs(packageBuildInputs(root));
                expect(afterSrc > before).toBeTruthy();

                // NEGATIVE: a file outside the input set must NOT move it.
                // Without this arm the suite also passes against an input set
                // that contains everything, i.e. against no cache at all.
                mkdirSync(join(root, 'dist'), { recursive: true });
                const later = future + 10_000;
                writeFileSync(join(root, 'dist', 'test.node.mjs'), '// output\n');
                utimesSync(join(root, 'dist', 'test.node.mjs'), later / 1000, later / 1000);
                mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
                writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), '// dep\n');
                utimesSync(join(root, 'node_modules', 'dep', 'index.js'), later / 1000, later / 1000);
                expect(newestInputMtimeMs(packageBuildInputs(root))).toBe(afterSrc);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
