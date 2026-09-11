// `gjsify barrels` action regression coverage.
//
// Action is decoupled from yargs, so we exercise the pure generator with
// tmp-dir fixtures: every test seeds a fresh sandbox under `os.tmpdir()`,
// runs the action, asserts the produced `index.ts`.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DEFAULT_BARRELS_EXCLUDES,
    DEFAULT_BARRELS_HEADER,
    generateBarrels,
    unscannableBarrelPaths,
} from './actions/barrels-generate.js';

async function makeSandbox(prefix: string): Promise<string> {
    return await mkdtemp(join(tmpdir(), `gjsify-barrels-${prefix}-`));
}

const defaultExcludes = DEFAULT_BARRELS_EXCLUDES.map((src) => new RegExp(src));

export default async () => {
    await describe('generateBarrels — basic output', async () => {
        await it('emits sorted `export *` lines for sibling .ts files', async () => {
            const root = await makeSandbox('basic');
            const dir = join(root, 'components');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'banana.ts'), 'export const banana = 1;');
            await writeFile(join(dir, 'apple.ts'), 'export const apple = 1;');

            const drift = await generateBarrels({
                paths: ['components'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            expect(drift).toBe(0);
            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            const expected = `${DEFAULT_BARRELS_HEADER}\n\nexport * from './apple'\nexport * from './banana'\n`;
            expect(out).toBe(expected);
            await rm(root, { recursive: true, force: true });
        });

        await it('emits `export type *` for a directory literally named `types`', async () => {
            const root = await makeSandbox('types');
            const dir = join(root, 'types');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'user.ts'), 'export interface User {}');

            await generateBarrels({
                paths: ['types'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(out.includes("export type * from './user'")).toBe(true);
            await rm(root, { recursive: true, force: true });
        });

        await it('emits `export {};` for an empty directory', async () => {
            const root = await makeSandbox('empty');
            const dir = join(root, 'empty');
            await mkdir(dir, { recursive: true });

            await generateBarrels({
                paths: ['empty'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(out).toBe(`${DEFAULT_BARRELS_HEADER}\n\nexport {};\n`);
            await rm(root, { recursive: true, force: true });
        });

        await it('skips files matching exclude regexes', async () => {
            const root = await makeSandbox('exclude');
            const dir = join(root, 'm');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'foo.ts'), '');
            await writeFile(join(dir, 'foo.test.ts'), '');
            await writeFile(join(dir, 'foo.spec.ts'), '');
            await writeFile(join(dir, 'foo.test-data.ts'), '');

            await generateBarrels({
                paths: ['m'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(out.includes("./foo'")).toBe(true);
            expect(out.includes('foo.test')).toBe(false);
            expect(out.includes('foo.spec')).toBe(false);
            expect(out.includes('foo.test-data')).toBe(false);
            await rm(root, { recursive: true, force: true });
        });

        await it('respects the `extension` setting', async () => {
            const root = await makeSandbox('ext');
            const dir = join(root, 'u');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'a.ts'), '');

            await generateBarrels({
                paths: ['u'],
                extension: 'js',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(out.includes("export * from './a.js'")).toBe(true);
            await rm(root, { recursive: true, force: true });
        });

        await it('respects `noSemicolon` / `singleQuotes` flags', async () => {
            const root = await makeSandbox('style');
            const dir = join(root, 's');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'x.ts'), '');

            await generateBarrels({
                paths: ['s'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: false,
                singleQuotes: false,
                check: false,
                verbose: false,
            });

            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(out.includes('export * from "./x";')).toBe(true);
            await rm(root, { recursive: true, force: true });
        });
    });

    await describe('generateBarrels — check mode', async () => {
        await it('returns drift count without writing when --check', async () => {
            const root = await makeSandbox('check-drift');
            const dir = join(root, 'd');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'a.ts'), '');
            await writeFile(join(dir, 'index.ts'), '// stale');

            const drift = await generateBarrels({
                paths: ['d'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: true,
                verbose: false,
            });

            expect(drift).toBe(1);
            // file NOT modified by --check
            const stale = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(stale).toBe('// stale');
            await rm(root, { recursive: true, force: true });
        });

        await it('returns 0 drift when files match canonical output', async () => {
            const root = await makeSandbox('check-clean');
            const dir = join(root, 'd');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'a.ts'), '');

            // First pass writes canonical output.
            await generateBarrels({
                paths: ['d'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            // Second pass in --check mode reports zero drift.
            const drift = await generateBarrels({
                paths: ['d'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: true,
                verbose: false,
            });

            expect(drift).toBe(0);
            await rm(root, { recursive: true, force: true });
        });
    });

    await describe('generateBarrels — robustness', async () => {
        await it('does not stop on missing directories, returns 0 drift', async () => {
            const root = await makeSandbox('missing');
            // dir intentionally not created
            const drift = await generateBarrels({
                paths: ['nope'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });
            expect(drift).toBe(0);
            await rm(root, { recursive: true, force: true });
        });

        await it('excludes index.ts itself from the listing', async () => {
            const root = await makeSandbox('selfexclude');
            const dir = join(root, 'm');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'a.ts'), '');
            await writeFile(join(dir, 'index.ts'), '// will be overwritten');

            await generateBarrels({
                paths: ['m'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(out.includes("./index'")).toBe(false);
            expect(out.includes("./a'")).toBe(true);
            await rm(root, { recursive: true, force: true });
        });

        await it('handles .mts and .tsx alongside .ts', async () => {
            const root = await makeSandbox('mts-tsx');
            const dir = join(root, 'm');
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, 'a.ts'), '');
            await writeFile(join(dir, 'b.mts'), '');
            await writeFile(join(dir, 'c.tsx'), '');
            await writeFile(join(dir, 'README.md'), '');

            await generateBarrels({
                paths: ['m'],
                extension: 'none',
                baseDir: root,
                exclude: defaultExcludes,
                header: DEFAULT_BARRELS_HEADER,
                noSemicolon: true,
                singleQuotes: true,
                check: false,
                verbose: false,
            });

            const out = await readFile(join(dir, 'index.ts'), 'utf-8');
            expect(out.includes("./a'")).toBe(true);
            expect(out.includes("./b'")).toBe(true);
            expect(out.includes("./c'")).toBe(true);
            expect(out.includes('README')).toBe(false);
            await rm(root, { recursive: true, force: true });
        });
    });

    await describe('unscannableBarrelPaths — what the command refuses before generating', async () => {
        await it('names a path that is not there, so --check cannot exit 0 on it', async () => {
            // The defect this closes: `generateBarrels` skips such a path and reports 0
            // drift for it, so `--check` passed for a barrel nothing had looked at, with
            // the only trace behind `--verbose`.
            const root = await makeSandbox('unscannable-missing');
            const problems = await unscannableBarrelPaths(root, ['nope']);
            expect(problems.length).toBe(1);
            expect(problems[0]!.includes('nope')).toBe(true);
            // The reason travels with the path — ENOENT and "it is a file" are different
            // mistakes and the caller fixes them differently.
            expect(problems[0]!.includes('ENOENT')).toBe(true);
            await rm(root, { recursive: true, force: true });
        });

        await it('names a path that is a FILE, which readdir would also refuse', async () => {
            const root = await makeSandbox('unscannable-file');
            await writeFile(join(root, 'notadir.ts'), '');
            const problems = await unscannableBarrelPaths(root, ['notadir.ts']);
            expect(problems.length).toBe(1);
            expect(problems[0]!.includes('is not a directory')).toBe(true);
            await rm(root, { recursive: true, force: true });
        });

        await it('reports every bad path, not just the first', async () => {
            const root = await makeSandbox('unscannable-many');
            await mkdir(join(root, 'good'), { recursive: true });
            const problems = await unscannableBarrelPaths(root, ['nope', 'good', 'alsonope']);
            expect(problems.length).toBe(2);
            expect(problems.some((p) => p.includes('good'))).toBe(false);
            await rm(root, { recursive: true, force: true });
        });

        await it('says nothing about a readable directory', async () => {
            const root = await makeSandbox('unscannable-ok');
            await mkdir(join(root, 'm'), { recursive: true });
            expect(await unscannableBarrelPaths(root, ['m'])).toStrictEqual([]);
            await rm(root, { recursive: true, force: true });
        });
    });
};
