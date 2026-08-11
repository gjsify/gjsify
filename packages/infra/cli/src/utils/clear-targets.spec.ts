// SPDX-License-Identifier: MIT
// Safety contract for `gjsify clear`'s target resolution.
//
// `gjsify clear` replaced `rm -rf` in hundreds of package `clear` scripts — none is
// left — so the paths it deletes come from config files, not from a human at a prompt. The
// tests that matter most are therefore the REFUSALS — and they are only testable
// at all because `readdir` is injected: proving that `../../sibling` is rejected
// must not involve creating anything outside the working directory.

import { describe, expect, it } from '@gjsify/unit';
import { join, resolve } from 'node:path';
import { hasWildcard, resolveClearTargets, segmentToRegExp } from './clear-targets.js';

const CWD = resolve('/tmp/gjsify-clear-fixture/packages/gjs/utils');

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
    await describe('resolveClearTargets — plain paths', async () => {
        await it('resolves each target against the package directory', () => {
            expect(resolveClearTargets(['lib', 'tsconfig.tsbuildinfo'], ctx())).toStrictEqual([
                join(CWD, 'lib'),
                join(CWD, 'tsconfig.tsbuildinfo'),
            ]);
        });

        await it('keeps a nested path', () => {
            expect(resolveClearTargets(['node_modules/.cache/gjsify-storybook'], ctx())).toStrictEqual([
                join(CWD, 'node_modules/.cache/gjsify-storybook'),
            ]);
        });

        await it('does not care whether the path exists — force semantics', () => {
            // `rm -rf` on a missing path is a no-op, which is what the `|| exit 0`
            // tail in the old scripts was for. Resolution must not stat.
            expect(resolveClearTargets(['never-built'], ctx())).toStrictEqual([join(CWD, 'never-built')]);
        });

        await it('dedupes repeated targets', () => {
            expect(resolveClearTargets(['lib', 'lib', './lib'], ctx())).toStrictEqual([join(CWD, 'lib')]);
        });
    });

    await describe('resolveClearTargets — refusals', async () => {
        await it('refuses the working directory itself', () => {
            expect(() => resolveClearTargets(['.'], ctx())).toThrow();
            expect(() => resolveClearTargets([''], ctx())).toThrow();
        });

        await it('refuses a parent-directory escape', () => {
            expect(() => resolveClearTargets(['..'], ctx())).toThrow();
            expect(() => resolveClearTargets(['../sibling'], ctx())).toThrow();
            expect(() => resolveClearTargets(['lib/../../sibling'], ctx())).toThrow();
        });

        await it('refuses an absolute path outside the package', () => {
            expect(() => resolveClearTargets(['/'], ctx())).toThrow();
            expect(() => resolveClearTargets([resolve('/tmp/gjsify-clear-fixture')], ctx())).toThrow();
        });

        await it('accepts an absolute path that IS inside the package', () => {
            expect(resolveClearTargets([join(CWD, 'dist')], ctx())).toStrictEqual([join(CWD, 'dist')]);
        });

        await it('names the offending path in the error', () => {
            // The message is the whole value of a refusal during a workspace-wide
            // `foreach` sweep.
            let message = '';
            try {
                resolveClearTargets(['../sibling'], ctx());
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('../sibling');
            expect(message).toContain(CWD);
        });

        await it('validates every target before returning any', () => {
            // The caller deletes what it gets back, so a bad third path must
            // fail the whole call rather than after two directories are gone.
            expect(() => resolveClearTargets(['lib', 'dist', '../oops'], ctx())).toThrow();
        });
    });

    await describe('resolveClearTargets — wildcards', async () => {
        await it('expands a trailing wildcard against one directory read', () => {
            const listing = { [CWD]: ['build.log', 'debug.log', 'keep.txt', 'src'] };
            expect(resolveClearTargets(['*.log'], ctx(listing))).toStrictEqual([
                join(CWD, 'build.log'),
                join(CWD, 'debug.log'),
            ]);
        });

        await it('expands a wildcard inside a subdirectory', () => {
            const listing = { [join(CWD, 'dist')]: ['a.map', 'b.map', 'index.js'] };
            expect(resolveClearTargets(['dist/*.map'], ctx(listing))).toStrictEqual([
                join(CWD, 'dist/a.map'),
                join(CWD, 'dist/b.map'),
            ]);
        });

        await it('yields nothing when the directory is absent', () => {
            expect(resolveClearTargets(['*.log'], ctx({}))).toStrictEqual([]);
        });

        await it('yields nothing when the pattern matches nothing', () => {
            expect(resolveClearTargets(['*.log'], ctx({ [CWD]: ['src', 'package.json'] }))).toStrictEqual([]);
        });

        await it('refuses a wildcard outside the last segment', () => {
            // A `**`-style sweep is not what a clear script should express.
            expect(() => resolveClearTargets(['*/dist'], ctx())).toThrow();
        });

        await it('refuses a wildcard whose parent escapes the package', () => {
            expect(() => resolveClearTargets(['../*.log'], ctx({ [resolve(CWD, '..')]: ['x.log'] }))).toThrow();
        });
    });

    await describe('wildcard matching', async () => {
        await it('treats * and ? as the shell does, and nothing else as special', () => {
            expect(segmentToRegExp('*.log').test('build.log')).toBe(true);
            expect(segmentToRegExp('*.log').test('build.log.bak')).toBe(false);
            expect(segmentToRegExp('a?.js').test('a1.js')).toBe(true);
            expect(segmentToRegExp('a?.js').test('a12.js')).toBe(false);
            // A literal dot must not match any character.
            expect(segmentToRegExp('a.js').test('axjs')).toBe(false);
            // Regex metacharacters in a filename are literals, not syntax.
            expect(segmentToRegExp('a+b(1).js').test('a+b(1).js')).toBe(true);
        });

        await it('a wildcard never crosses a path separator', () => {
            expect(segmentToRegExp('*').test('a/b')).toBe(false);
            expect(segmentToRegExp('*').test('a\\b')).toBe(false);
        });

        await it('recognises which segments carry a wildcard', () => {
            expect(hasWildcard('*.log')).toBe(true);
            expect(hasWildcard('a?.js')).toBe(true);
            expect(hasWildcard('tsconfig.tsbuildinfo')).toBe(false);
        });
    });
};
