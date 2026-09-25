// SPDX-License-Identifier: MIT
// `extractPackageSpec` — the node_modules path → module SPECIFIER conversion the
// path rewriter bakes into every bundle it touches.
//
// Why this is worth pinning: the output is written into the shipped bundle as
// the argument to `__gjsifyModuleFile`/`__gjsifyModuleDir`, and the runtime
// resolver feeds it to `createRequire(...).resolve`. If the conversion fails,
// the bundle carries the ABSOLUTE PATH OF THE BUILD MACHINE and resolves
// nothing anywhere else.
//
// That is exactly what happened on win32: the marker is `node_modules/`, the
// path is `C:\…\node_modules\typescript\lib\_tsc.js`, `lastIndexOf` returned -1
// and the whole path fell through. `shouldRewrite` tests
// `includes('node_modules')` with no separator, so the rewriter still fired.
// Only `@gjsify/tsc`'s own build guard noticed, and only because it asserts the
// spec it expects to find — the general case would have shipped.
//
// `platform` is injected, so the win32 branch runs on Linux and macOS too. That
// matters more here than usual: nothing else in CI builds on Windows, so this
// suite is the only thing standing between that regression and a release.
//
// Tested from @gjsify/cli's harness because the plugin package has no
// `test:node` script of its own — same placement rationale as
// `entry-points.spec.ts` / `alias-plugin.spec.ts`.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import { extractPackageSpec, rewriteContents } from '@gjsify/rolldown-plugin-gjsify';

/**
 * Run the `var __dirname`/`var __filename` preamble a rewrite emitted, as if the
 * bundle lived at `bundleUrl`, and return what the two names came out as.
 *
 * The preamble is lifted off the rewritten code and evaluated, not string-matched:
 * the defect is in what the expression EVALUATES to, and a raw file on disk could
 * not be imported under GJS, where `node:url` only exists inside a bundle. So the
 * import line is dropped and the test's own `fileURLToPath` is passed in under the
 * name that line would have bound.
 */
function evalPreamble(code: string, bundleUrl: string): { dirname: string; filename: string } {
    const lines = code.split('\n').filter((line) => line.startsWith('var __'));
    const body = lines.join('\n').replaceAll('import.meta.url', JSON.stringify(bundleUrl));
    const run = new Function('__gjsifyFileURLToPath', `${body}\nreturn [__dirname, __filename];`);
    const [dirname, filename] = run(fileURLToPath) as [string, string];
    return { dirname, filename };
}

export default async () => {
    await describe('extractPackageSpec — POSIX paths', async () => {
        await it('takes everything after the node_modules segment', async () => {
            expect(extractPackageSpec('/ws/node_modules/typedoc/dist/lib/app.js', 'linux')).toBe(
                'typedoc/dist/lib/app.js',
            );
        });

        await it('keeps a scoped package name whole', async () => {
            expect(extractPackageSpec('/ws/node_modules/@scope/name/sub.js', 'linux')).toBe('@scope/name/sub.js');
        });

        await it('uses the LAST node_modules, so a nested dep wins', async () => {
            expect(extractPackageSpec('/ws/node_modules/a/node_modules/b/file.js', 'linux')).toBe('b/file.js');
        });

        await it('returns a path with no node_modules unchanged', async () => {
            expect(extractPackageSpec('/ws/src/index.js', 'linux')).toBe('/ws/src/index.js');
        });

        await it('leaves a backslash alone off win32, where it is a legal filename char', async () => {
            // `a\b.js` is one file named `a\b.js` on POSIX. Rewriting it would
            // invent a directory boundary that does not exist.
            expect(extractPackageSpec('/ws/node_modules/pkg/a\\b.js', 'linux')).toBe('pkg/a\\b.js');
        });
    });

    await describe('extractPackageSpec — win32 paths', async () => {
        await it('converts a backslash path to a package spec', async () => {
            // The regression: this returned the whole absolute path, and the
            // bundle shipped `C:\src\…` as its runtime resolve spec.
            expect(extractPackageSpec('C:\\src\\ws\\node_modules\\typescript\\lib\\_tsc.js', 'win32')).toBe(
                'typescript/lib/_tsc.js',
            );
        });

        await it('produces the SAME spec as the POSIX spelling of the same file', async () => {
            // The spec is a module specifier, not a path — the bundle must not
            // be able to tell which host built it.
            expect(extractPackageSpec('C:\\ws\\node_modules\\@scope\\name\\sub.js', 'win32')).toBe(
                extractPackageSpec('/ws/node_modules/@scope/name/sub.js', 'linux'),
            );
        });

        await it('uses the LAST node_modules there too', async () => {
            expect(extractPackageSpec('C:\\ws\\node_modules\\a\\node_modules\\b\\file.js', 'win32')).toBe('b/file.js');
        });

        await it('handles a path that already uses forward slashes', async () => {
            // Node hands out mixed spellings; the conversion must be idempotent.
            expect(extractPackageSpec('C:/ws/node_modules/typescript/lib/_tsc.js', 'win32')).toBe(
                'typescript/lib/_tsc.js',
            );
        });

        await it('still returns something usable when there is no node_modules', async () => {
            // Not a package file — but the caller writes this into the bundle,
            // so it must at least be separator-consistent.
            expect(extractPackageSpec('C:\\ws\\src\\index.js', 'win32')).toBe('C:/ws/src/index.js');
        });
    });

    await describe('rewriteContents — __dirname/__filename are filesystem paths', async () => {
        // Cases 2 (build-relative) and 3 (PnP zip) derived both names from
        // `new URL(…).pathname`, a URL path: `%20` stayed encoded on every OS, and on
        // win32 the drive came out as `/C:/…`, which nothing on Windows opens. Both
        // now go through `fileURLToPath`; the space shows the difference on any host.
        const root = join(fileURLToPath(pathToFileURL('.')), 'my app');
        const bundleDir = join(root, 'dist');
        const bundleUrl = pathToFileURL(join(bundleDir, 'bundle.js')).href;
        const dep = join(root, 'node_modules', 'pkg', 'lib', 'x.js');
        const src = 'export const u = import.meta.url, d = __dirname, f = __filename;';

        await it('decodes the build-relative case to the dep file itself', async () => {
            const out = rewriteContents({ path: dep }, src, bundleDir, false);
            const got = evalPreamble(out!.code, bundleUrl);
            expect(got.filename).toBe(dep);
            expect(got.dirname).toBe(join(root, 'node_modules', 'pkg', 'lib'));
        });

        await it('decodes the zip-resident case to the bundle itself', async () => {
            const zipped = join(bundleDir, 'cache', 'pkg.zip', 'node_modules', 'pkg', 'x.js');
            const out = rewriteContents({ path: zipped }, src, bundleDir, false);
            const got = evalPreamble(out!.code, bundleUrl);
            expect(got.filename).toBe(join(bundleDir, 'bundle.js'));
            expect(got.dirname).toBe(bundleDir);
        });
    });
};
