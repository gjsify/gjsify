// SPDX-License-Identifier: MIT
// Parse-level contract for `gjsify build`'s glob-bearing options.
//
// `--entry-points` (the `[entryPoints..]` positional) and `--exclude` carry
// GLOB PATTERNS, and they must reach `globToEntryPoints` byte-for-byte as the
// user wrote them. yargs' `normalize: true` breaks exactly that: it runs
// `path.normalize()` over every value, and on win32 that rewrites separators.
// fast-glob then sees `src\**\*.{ts,js}`, finds no static base, walks from `.`,
// follows the workspace's relative `node_modules/@gjsify/*` symlinks with
// unbounded depth and no cycle detection, and dies of heap exhaustion after
// tens of minutes — with no error and no output file until then. That is issue
// #914's `--library` slowness report; `commands/build.ts` carries the full
// account.
//
// THIS IS THE GUARD AGAINST THE ROOT CAUSE COMING BACK, and it runs on every
// host: `path.normalize` is not a no-op on POSIX either — it collapses `./` and
// `x/../` segments. So a pattern that survives those UNCHANGED proves no path
// normalization is applied, on Linux, macOS and Windows alike. Without it the
// regression is invisible off win32, which is how it survived long enough to
// take out a whole toolchain run.
//
// `entry-points.spec.ts` covers the second layer (what `globToEntryPoints` does
// when a backslashed pattern reaches it anyway).

import { describe, expect, it } from '@gjsify/unit';
import yargs from 'yargs';
import { buildCommand } from './commands/build.js';

/** Run argv through the REAL builder, capture the parsed args, run no build. */
async function parseBuildArgs(argv: string[]): Promise<Record<string, unknown>> {
    let captured: Record<string, unknown> = {};
    await yargs(argv)
        .command(buildCommand.command, buildCommand.description, buildCommand.builder, (args) => {
            captured = args as unknown as Record<string, unknown>;
        })
        .parseAsync();
    return captured;
}

export default async () => {
    await describe('gjsify build — glob options are not path-normalized', async () => {
        await it('passes an entry-point pattern through verbatim', async () => {
            // `src/./**` and `src/x/../**` are what `path.normalize` collapses
            // on EVERY platform — the host-independent probe for the flag.
            const args = await parseBuildArgs(['build', '--library', 'src/./**/*.{ts,js}']);
            expect(args.entryPoints).toStrictEqual(['src/./**/*.{ts,js}']);
        });

        await it('passes an --exclude pattern through verbatim', async () => {
            const args = await parseBuildArgs(['build', 'src/index.ts', '--exclude', 'src/x/../**/*.spec.ts']);
            expect(args.exclude).toStrictEqual(['src/x/../**/*.spec.ts']);
        });

        await it('keeps every positional entry point, in order', async () => {
            const args = await parseBuildArgs(['build', '--library', 'src/a.ts', 'src/b.ts', 'src/c.ts']);
            expect(args.entryPoints).toStrictEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
        });

        await it('parses --library as a real boolean, not a normalized string', async () => {
            // `normalize` makes yargs treat the key as a string — which also
            // rendered seven boolean flags as `[string]` in `--help`. A boolean
            // here is the cheap signal that the flag has not crept back.
            const args = await parseBuildArgs(['build', '--library', 'src/index.ts']);
            expect(args.library).toBe(true);
            expect(typeof args.library).toBe('boolean');
        });

        await it('still normalizes --outdir, which IS a single path', async () => {
            // The fix is scoped: `outfile`/`outdir` are paths, nothing globs
            // them, and collapsing `./` there is wanted.
            const args = await parseBuildArgs(['build', '--library', 'src/index.ts', '--outdir', 'lib/./esm']);
            expect(args.outdir).toBe('lib/esm');
        });
    });
};
