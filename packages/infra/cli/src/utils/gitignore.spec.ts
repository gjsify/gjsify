// Tests for the gitignore matcher every native-skip-scan ignore layer reads through.

import { describe, it, expect } from '@gjsify/unit';
import { compileGitignore } from './gitignore.js';

const BASE = '/repo';
const at = (rel: string): string => `${BASE}/${rel}`;

export default async () => {
    await describe('compileGitignore', async () => {
        await it('matches a slash-free pattern at any depth', async () => {
            const m = compileGitignore(['*.log'], BASE);
            expect(m.matched(at('a.log'), false)).toBe('ignore');
            expect(m.matched(at('deep/er/a.log'), false)).toBe('ignore');
            expect(m.matched(at('a.log.txt'), false)).toBe(null);
        });

        await it('anchors a pattern that contains a slash', async () => {
            const m = compileGitignore(['/build', 'docs/out'], BASE);
            expect(m.matched(at('build'), true)).toBe('ignore');
            expect(m.matched(at('pkg/build'), true)).toBe(null);
            expect(m.matched(at('docs/out'), true)).toBe('ignore');
            expect(m.matched(at('pkg/docs/out'), true)).toBe(null);
        });

        await it('applies a trailing-slash pattern to directories only', async () => {
            const m = compileGitignore(['lib/'], BASE);
            expect(m.matched(at('pkg/lib'), true)).toBe('ignore');
            expect(m.matched(at('pkg/lib'), false)).toBe(null);
        });

        await it('lets the last matching line decide, so `!` re-includes', async () => {
            const m = compileGitignore(['lib/', '!pkg/lib/'], BASE);
            expect(m.matched(at('other/lib'), true)).toBe('ignore');
            expect(m.matched(at('pkg/lib'), true)).toBe('whitelist');
        });

        await it('handles `**/`, `/**/` and a trailing `/**`', async () => {
            const m = compileGitignore(['**/node_modules', 'a/**/z.md', 'gen/**'], BASE);
            expect(m.matched(at('node_modules'), true)).toBe('ignore');
            expect(m.matched(at('x/y/node_modules'), true)).toBe('ignore');
            expect(m.matched(at('a/z.md'), false)).toBe('ignore');
            expect(m.matched(at('a/b/c/z.md'), false)).toBe('ignore');
            expect(m.matched(at('gen/x/y.ts'), false)).toBe('ignore');
            expect(m.matched(at('gen'), true)).toBe(null);
        });

        await it('keeps `*` and `?` inside one path segment', async () => {
            const m = compileGitignore(['src/*.md', 'f?.ts'], BASE);
            expect(m.matched(at('src/a.md'), false)).toBe('ignore');
            expect(m.matched(at('src/deep/a.md'), false)).toBe(null);
            expect(m.matched(at('f1.ts'), false)).toBe('ignore');
            expect(m.matched(at('f12.ts'), false)).toBe(null);
        });

        await it('reads character classes, comments, escapes and trailing spaces', async () => {
            const m = compileGitignore(['# comment', '[ab].md', '[!x]y.md', '\\#hash', 'space.md   ', ''], BASE);
            expect(m.matched(at('a.md'), false)).toBe('ignore');
            expect(m.matched(at('c.md'), false)).toBe(null);
            expect(m.matched(at('zy.md'), false)).toBe('ignore');
            expect(m.matched(at('xy.md'), false)).toBe(null);
            expect(m.matched(at('#hash'), false)).toBe('ignore');
            expect(m.matched(at('space.md'), false)).toBe('ignore');
            expect(m.matched(at('comment'), false)).toBe(null);
        });

        // gitignore treats `\-` inside a class as a literal `-`; doubling the
        // backslash for the regex would turn `[a\-z]` into a range.
        await it('keeps an escaped dash inside a class literal, not a range', async () => {
            const m = compileGitignore(['[a\\-z].md'], BASE);
            expect(m.matched(at('a.md'), false)).toBe('ignore');
            expect(m.matched(at('z.md'), false)).toBe('ignore');
            expect(m.matched(at('-.md'), false)).toBe('ignore');
            expect(m.matched(at('b.md'), false)).toBe(null);
        });

        await it('never decides a path outside its base', async () => {
            const m = compileGitignore(['*.md'], BASE);
            expect(m.matched('/elsewhere/a.md', false)).toBe(null);
            expect(m.matched(BASE, true)).toBe(null);
        });

        await it('matchedPathOrAnyParents hides a file under an ignored directory', async () => {
            const m = compileGitignore(['**/dist'], BASE);
            expect(m.matched(at('pkg/dist/a.md'), false)).toBe(null);
            expect(m.matchedPathOrAnyParents(at('pkg/dist/a.md'), false)).toBe('ignore');
            expect(m.matchedPathOrAnyParents(at('pkg/src/a.md'), false)).toBe(null);
        });
    });
};
