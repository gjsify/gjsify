// SPDX-License-Identifier: MIT
// Contract for `gjsify copy`'s target resolution.
//
// Two things are being pinned here, and only the first is obvious.
//
// The obvious one is the refusals: a destination outside the package must be
// rejected, and proving that must not involve writing anything outside the
// working directory — which is why `readdir` is injected.
//
// The load-bearing one is that the SAME argument list means the same thing on
// both platforms. A POSIX shell expands `src/public/*` before gjsify starts;
// cmd.exe passes the pattern through untouched. The two therefore reach
// `planCopy` as different argument lists, and the pair of tests marked "same
// script, both platforms" is what keeps them landing on the same plan.

import { describe, expect, it } from '@gjsify/unit';
import { join, resolve } from 'node:path';
import { isDirectoryDestination, planCopy } from './copy-targets.js';

const CWD = resolve('/tmp/gjsify-copy-fixture/showcases/node/express-webserver');

/** A context whose "filesystem" is exactly the given directory listing. */
function ctx(listing: Record<string, string[]> = {}) {
    return {
        cwd: CWD,
        readdir: (dir: string) => {
            const entries = listing[dir];
            if (!entries) throw new Error(`ENOENT: ${dir}`);
            return entries;
        },
    };
}

export default async () => {
    await describe('isDirectoryDestination', async () => {
        await it('is a directory when the destination says so with a trailing separator', () => {
            expect(isDirectoryDestination(['a.html'], 'dist/')).toBe(true);
            // Windows spelling — a script may be written either way, and the
            // meaning must not depend on which.
            expect(isDirectoryDestination(['a.html'], 'dist\\')).toBe(true);
        });

        await it('is a directory when several sources are given', () => {
            expect(isDirectoryDestination(['a.html', 'b.css'], 'dist')).toBe(true);
        });

        await it('is a directory when a source carries a wildcard', () => {
            expect(isDirectoryDestination(['src/public/*'], 'dist')).toBe(true);
        });

        await it('is the exact target path for one plain source', () => {
            expect(isDirectoryDestination(['src/browser/index.html'], 'dist/index.html')).toBe(false);
            expect(isDirectoryDestination(['src/assets'], 'dist/res')).toBe(false);
        });

        await it('never consults the filesystem', () => {
            // The whole point of the rule: `cp -r src/assets dist/res` copies to
            // `dist/res` the first time and to `dist/res/assets` the second,
            // because it stats the destination. This decides from the arguments,
            // so a second run does exactly what the first did.
            expect(isDirectoryDestination(['src/assets'], 'dist/res')).toBe(false);
        });
    });

    await describe('planCopy — a single source', async () => {
        await it('copies a file to the exact destination path', () => {
            expect(planCopy(['src/browser/index.html', 'dist/index.html'], ctx())).toStrictEqual([
                { from: join(CWD, 'src/browser/index.html'), to: join(CWD, 'dist/index.html') },
            ]);
        });

        await it('copies a directory to the exact destination path', () => {
            expect(planCopy(['src/public', 'dist/public'], ctx())).toStrictEqual([
                { from: join(CWD, 'src/public'), to: join(CWD, 'dist/public') },
            ]);
        });

        await it('copies into the destination when it ends with a separator', () => {
            expect(planCopy(['src/index.html', 'dist/'], ctx())).toStrictEqual([
                { from: join(CWD, 'src/index.html'), to: join(CWD, 'dist/index.html') },
            ]);
        });

        await it('reads from outside the package — writing is the guarded direction', () => {
            // `tests/integration/lightningcss` stages a wasm artifact out of a
            // sibling package. Refusing that would break the shape this command
            // exists to replace.
            const plan = planCopy(
                ['../../../packages/infra/lightningcss-wasm/wasm/lightningcss_node.wasm', 'wasm/'],
                ctx(),
            );
            expect(plan).toStrictEqual([
                {
                    from: resolve(CWD, '../../../packages/infra/lightningcss-wasm/wasm/lightningcss_node.wasm'),
                    to: join(CWD, 'wasm/lightningcss_node.wasm'),
                },
            ]);
        });

        await it('accepts the package root itself as a destination directory', () => {
            expect(planCopy(['../shared/theme.css', './'], ctx())).toStrictEqual([
                { from: resolve(CWD, '../shared/theme.css'), to: join(CWD, 'theme.css') },
            ]);
        });
    });

    await describe('planCopy — several sources', async () => {
        await it('copies each source into the destination directory', () => {
            expect(planCopy(['src/a.html', 'src/b.css', 'dist'], ctx())).toStrictEqual([
                { from: join(CWD, 'src/a.html'), to: join(CWD, 'dist/a.html') },
                { from: join(CWD, 'src/b.css'), to: join(CWD, 'dist/b.css') },
            ]);
        });

        await it('refuses two sources that would land on one destination', () => {
            expect(() => planCopy(['src/a/theme.css', 'src/b/theme.css', 'dist/'], ctx())).toThrow();
        });
    });

    await describe('planCopy — wildcards', async () => {
        const listing = {
            [join(CWD, 'src/public')]: ['index.html', 'style.css', 'app.js'],
            [join(CWD, 'src/fixtures')]: ['a.mjs', 'b.mjs', 'notes.md'],
        };

        await it('expands a wildcard in the last segment, sorted', () => {
            expect(planCopy(['src/public/*', 'dist/public/'], ctx(listing))).toStrictEqual([
                { from: join(CWD, 'src/public/app.js'), to: join(CWD, 'dist/public/app.js') },
                { from: join(CWD, 'src/public/index.html'), to: join(CWD, 'dist/public/index.html') },
                { from: join(CWD, 'src/public/style.css'), to: join(CWD, 'dist/public/style.css') },
            ]);
        });

        await it('honours an extension filter', () => {
            expect(planCopy(['src/fixtures/*.mjs', 'fixtures/'], ctx(listing))).toStrictEqual([
                { from: join(CWD, 'src/fixtures/a.mjs'), to: join(CWD, 'fixtures/a.mjs') },
                { from: join(CWD, 'src/fixtures/b.mjs'), to: join(CWD, 'fixtures/b.mjs') },
            ]);
        });

        await it('yields nothing when the pattern matches nothing', () => {
            expect(planCopy(['src/public/*.woff2', 'dist/public/'], ctx(listing))).toStrictEqual([]);
        });

        await it('yields nothing when the source directory does not exist', () => {
            expect(planCopy(['src/absent/*', 'dist/'], ctx(listing))).toStrictEqual([]);
        });

        await it('refuses a wildcard outside the last segment', () => {
            expect(() => planCopy(['src/*/index.html', 'dist/'], ctx(listing))).toThrow();
        });

        await it('same script, both platforms — the shell-expanded form plans identically', () => {
            // What a POSIX shell hands over after expanding `src/public/*`…
            const posix = planCopy(
                [
                    join(CWD, 'src/public/app.js'),
                    join(CWD, 'src/public/index.html'),
                    join(CWD, 'src/public/style.css'),
                    'dist/public/',
                ],
                ctx(listing),
            );
            // …and what cmd.exe hands over, having expanded nothing.
            const win32 = planCopy(['src/public/*', 'dist/public/'], ctx(listing));
            expect(posix).toStrictEqual(win32);
        });

        await it('same script, both platforms — a one-match pattern still copies INTO the directory', () => {
            // The asymmetric case: the shell expands to a SINGLE source, which
            // without the trailing separator would read as an exact destination
            // path. The trailing `/` in every rewritten script is what closes it,
            // and this is the test that would fail if one were dropped.
            const one = { [join(CWD, 'src/only')]: ['solo.html'] };
            const posix = planCopy([join(CWD, 'src/only/solo.html'), 'dist/'], ctx(one));
            const win32 = planCopy(['src/only/*', 'dist/'], ctx(one));
            expect(posix).toStrictEqual(win32);
            expect(win32).toStrictEqual([{ from: join(CWD, 'src/only/solo.html'), to: join(CWD, 'dist/solo.html') }]);
        });
    });

    await describe('planCopy — refusals', async () => {
        await it('refuses a destination outside the package', () => {
            expect(() => planCopy(['src/a.html', '../sibling/a.html'], ctx())).toThrow();
            expect(() => planCopy(['src/a.html', '../../a.html'], ctx())).toThrow();
        });

        await it('refuses an absolute destination outside the package', () => {
            expect(() => planCopy(['src/a.html', resolve('/etc/a.html')], ctx())).toThrow();
        });

        await it('refuses the working directory as an exact destination', () => {
            // `gjsify copy x .` is ambiguous: overwrite the package with a file?
            // `gjsify copy x ./` is not, and the message says so.
            expect(() => planCopy(['src/a.html', '.'], ctx())).toThrow();
        });

        await it('refuses copying a path onto itself', () => {
            expect(() => planCopy(['dist/index.html', 'dist/index.html'], ctx())).toThrow();
        });

        await it('refuses an empty source or destination', () => {
            expect(() => planCopy(['', 'dist/'], ctx())).toThrow();
            expect(() => planCopy(['src/a.html', ''], ctx())).toThrow();
        });

        await it('refuses fewer than two arguments', () => {
            expect(() => planCopy(['dist'], ctx())).toThrow();
            expect(() => planCopy([], ctx())).toThrow();
        });
    });
};
