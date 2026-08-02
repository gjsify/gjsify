// Regression coverage for the `--library` src-leak guard.
//
// `BuildAction.buildLibrary` derives its output dir from `dirname(module ??
// main)`. A package whose `main` points at its SOURCE entry (`src/index.ts`,
// the Vite/gjsify-compiled runtime entry) makes that derived dir `src/`, so a
// `--library` build writes `.js` duplicates + `_virtual/` + a nested
// preserve-modules tree over the sources. These rows pin the pure helpers the
// build action uses to refuse that up front.

import { describe, expect, it } from '@gjsify/unit';
import { resolve } from 'node:path';
import { inputSourceDirs, isOutdirInsideSource } from './library-output.js';

const CWD = '/proj';

/**
 * An expected absolute path, built with the same `path.resolve` the helpers
 * under test use.
 *
 * `inputSourceDirs` resolves against the host's path flavour, so on Windows
 * `resolve('/proj', 'src')` is `C:\proj\src` — the drive comes from the cwd and
 * the separator from the platform. Hardcoding `'/proj/src'` therefore compared
 * a POSIX literal against a Windows path and failed there for a reason none of
 * these rows are about; they pin how a glob reduces to its directory prefix,
 * which is separator-independent.
 */
function at(...parts: string[]): string {
    return resolve(CWD, ...parts);
}

export default async () => {
    await describe('inputSourceDirs', async () => {
        await it('maps a file entry to its containing dir', () => {
            expect(inputSourceDirs('src/index.ts', CWD)).toStrictEqual([at('src')]);
        });

        await it('reduces a glob to its literal directory prefix', () => {
            expect(inputSourceDirs('src/**/*.ts', CWD)).toStrictEqual([at('src')]);
            expect(inputSourceDirs('src/components/*.ts', CWD)).toStrictEqual([at('src/components')]);
        });

        await it('accepts a bare directory input', () => {
            expect(inputSourceDirs('src', CWD)).toStrictEqual([at('src')]);
        });

        await it('handles an array of inputs, de-duplicated', () => {
            expect(inputSourceDirs(['src/index.ts', 'src/other.ts'], CWD)).toStrictEqual([at('src')]);
        });

        await it('excludes the project root itself (flat layout is not the footgun)', () => {
            // Source at the project root → no guarded source dir.
            expect(inputSourceDirs('index.ts', CWD)).toStrictEqual([]);
        });

        await it('ignores non-string input shapes gracefully', () => {
            expect(inputSourceDirs(undefined, CWD)).toStrictEqual([]);
            expect(inputSourceDirs({ a: 'src/a.ts', b: 5 }, CWD)).toStrictEqual([at('src')]);
        });
    });

    await describe('isOutdirInsideSource', async () => {
        const sourceDirs = [at('src')];

        await it('flags an outdir that IS the source dir (the leak)', () => {
            expect(isOutdirInsideSource('src', sourceDirs, CWD)).toBe(true);
        });

        await it('flags an outdir nested under the source dir', () => {
            expect(isOutdirInsideSource('src/nested', sourceDirs, CWD)).toBe(true);
        });

        await it('allows a sibling build dir', () => {
            expect(isOutdirInsideSource('dist/esm', sourceDirs, CWD)).toBe(false);
            expect(isOutdirInsideSource('lib', sourceDirs, CWD)).toBe(false);
        });

        await it('allows the project root even when source is a subdir', () => {
            expect(isOutdirInsideSource('.', sourceDirs, CWD)).toBe(false);
        });

        await it('is a no-op when there are no source dirs to protect', () => {
            expect(isOutdirInsideSource('src', [], CWD)).toBe(false);
        });

        await it('matches the real @gjsify/adwaita-web shape (main: src/index.ts)', () => {
            // main "src/index.ts" → derived outdir "src"; input "src/index.ts".
            const dirs = inputSourceDirs('src/index.ts', CWD);
            expect(isOutdirInsideSource('src', dirs, CWD)).toBe(true);
        });
    });
};
