// Tests for native-skip-scan — the pre-scan that surfaces files napi oxfmt
// would format but the native oxfmt (GJS) drops, so `gjsify format --check`
// cannot pass having skipped them. It must see exactly oxfmt's file set:
// reporting a file oxfmt would never open reds a clean tree.

import { describe, it, expect } from '@gjsify/unit';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { externalParserFor, parseJsonc, scanForNativeSkips } from './native-skip-scan.js';

let counter = 0;
function tree(files: Record<string, string>): string {
    const dir = join(tmpdir(), `gjsify-skip-scan-${process.pid}-${Date.now()}-${counter++}`);
    mkdirSync(dir, { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
        const full = join(dir, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body);
    }
    return dir;
}

const names = (dir: string, files: string[]): string[] => files.map((f) => f.slice(dir.length + 1)).sort();

export default async () => {
    await describe('scanForNativeSkips', async () => {
        await it('reports the files napi oxfmt hands to Prettier (Markdown, HTML, Vue, YAML)', async () => {
            const dir = tree({
                'README.md': '# Hello',
                'index.html': '<html></html>',
                'App.vue': '<template><div /></template>',
                'ci.yml': 'a: 1',
            });
            const result = scanForNativeSkips([dir], dir);
            expect(names(dir, result.skipped)).toStrictEqual(['App.vue', 'README.md', 'ci.yml', 'index.html']);
            rmSync(dir, { recursive: true, force: true });
        });

        // The native build formats these itself — flagging them failed the check
        // on files it had in fact checked.
        await it('does NOT report what the native build formats: JS/TS, JSON, TOML, CSS', async () => {
            const dir = tree({
                'index.ts': 'const x: number = 1;',
                'main.js': 'const x = 1;',
                'data.json': '{}',
                'Cargo.toml': '[package]',
                'style.css': 'body {}',
                'theme.scss': 'a {}',
                'x.less': 'a {}',
            });
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(0);
            expect(result.total).toBe(7);
            rmSync(dir, { recursive: true, force: true });
        });

        // THE INCIDENT: the scan walked node_modules and exited 1 on dependency
        // READMEs, so `format --check` from source never started oxfmt.
        await it('never enters node_modules or VCS directories', async () => {
            const dir = tree({
                'src/index.ts': 'const x = 1;',
                'node_modules/dep/README.md': '# dep',
                'packages/a/node_modules/dep/index.html': '<p></p>',
                '.git/description.md': 'x',
                '.hg/x.md': 'x',
            });
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(0);
            expect(result.total).toBe(1);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('honours the config ignorePatterns, relative to the config directory', async () => {
            const dir = tree({
                '.oxfmtrc.json': '{\n  // comment\n  "ignorePatterns": ["**/*.md", "vendor",],\n}',
                'README.md': '# x',
                'docs/deep/guide.md': '# x',
                'vendor/page.html': '<p></p>',
                'site/page.html': '<p></p>',
            });
            const result = scanForNativeSkips([dir], dir, { configPath: join(dir, '.oxfmtrc.json') });
            expect(names(dir, result.skipped)).toStrictEqual(['site/page.html']);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('discovers the config when none is passed, and a nested one scopes its subtree', async () => {
            const dir = tree({
                '.oxfmtrc.json': '{ "ignorePatterns": ["*.html"] }',
                'a.html': '<p></p>',
                'sub/.oxfmtrc.jsonc': '{ "ignorePatterns": ["*.md"] }',
                'sub/b.md': '# x',
                'sub/c.html': '<p></p>',
            });
            const result = scanForNativeSkips(['.'], dir);
            // `sub`'s own config replaces the root one there: .md ignored, .html not.
            expect(names(dir, result.skipped)).toStrictEqual(['sub/c.html']);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('honours nested .gitignore files and .prettierignore', async () => {
            const dir = tree({
                '.gitignore': 'build/\n*.generated.md\n',
                '.prettierignore': 'legacy\n',
                'build/out.html': '<p></p>',
                'notes.generated.md': '# x',
                'pkg/.gitignore': 'private.md\n',
                'pkg/private.md': '# x',
                'pkg/public.md': '# x',
                'legacy/old.md': '# x',
            });
            const result = scanForNativeSkips(['.'], dir);
            expect(names(dir, result.skipped)).toStrictEqual(['pkg/public.md']);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('reads .gitignore up to the repository root, never above it', async () => {
            const outer = tree({
                '.gitignore': '*.md\n',
                'repo/.git/info/exclude': 'excluded.html\n',
                'repo/.gitignore': 'ignored.html\n',
                'repo/pkg/kept.md': '# x',
                'repo/pkg/ignored.html': '<p></p>',
                'repo/pkg/excluded.html': '<p></p>',
            });
            const repo = join(outer, 'repo');
            const result = scanForNativeSkips(['pkg'], repo);
            expect(names(repo, result.skipped)).toStrictEqual(['pkg/kept.md']);
            rmSync(outer, { recursive: true, force: true });
        });

        await it('holds a file named directly to ignorePatterns but not to .gitignore', async () => {
            const dir = tree({
                '.gitignore': '*.md\n',
                '.oxfmtrc.json': '{ "ignorePatterns": ["*.html"] }',
                'a.md': '# x',
                'b.html': '<p></p>',
            });
            const cfg = { configPath: join(dir, '.oxfmtrc.json') };
            expect(scanForNativeSkips(['a.md'], dir, cfg).skipped).toStrictEqual([join(dir, 'a.md')]);
            expect(scanForNativeSkips(['b.html'], dir, cfg).skipped).toHaveLength(0);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('applies `!` CLI excludes and glob arguments', async () => {
            const dir = tree({ 'a/x.md': '# x', 'b/y.md': '# x', 'b/z.html': '<p></p>' });
            expect(names(dir, scanForNativeSkips(['.', '!b'], dir).skipped)).toStrictEqual(['a/x.md']);
            expect(names(dir, scanForNativeSkips(['**/*.html'], dir).skipped)).toStrictEqual(['b/z.html']);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('returns empty for non-existent paths', async () => {
            const dir = tree({});
            const result = scanForNativeSkips([join(dir, 'does-not-exist')], dir);
            expect(result.skipped).toHaveLength(0);
            expect(result.total).toBe(0);
            rmSync(dir, { recursive: true, force: true });
        });

        // `resolve`, not `join`: `gjsify format --check /srv/app` from an unrelated
        // cwd must still scan /srv/app, or the check passes having seen nothing.
        await it('scans an absolute path that is NOT under cwd', async () => {
            const dir = tree({ 'README.md': '# x' });
            const elsewhere = tree({});
            const result = scanForNativeSkips([dir], elsewhere);
            expect(result.skipped).toStrictEqual([join(dir, 'README.md')]);
            rmSync(dir, { recursive: true, force: true });
            rmSync(elsewhere, { recursive: true, force: true });
        });
    });

    await describe('externalParserFor', async () => {
        await it('mirrors oxfmt: lock files are never formatted, svelte needs its option', async () => {
            expect(externalParserFor('pnpm-lock.yaml')).toBe(null);
            expect(externalParserFor('README')).toBe('markdown');
            expect(externalParserFor('x.MD')).toBe(null);
            expect(externalParserFor('App.svelte')).toBe(null);
            expect(externalParserFor('App.svelte', true)).toBe('svelte');
            expect(externalParserFor('a.tsx')).toBe(null);
        });
    });

    await describe('parseJsonc', async () => {
        await it('drops comments and trailing commas but never touches strings', async () => {
            const parsed = parseJsonc('{ "a": "x // y", "b": ["/* z */", "q,]"], /* c */ "c": 1, }') as Record<
                string,
                unknown
            >;
            expect(parsed.a).toBe('x // y');
            expect(parsed.b).toStrictEqual(['/* z */', 'q,]']);
            expect(parsed.c).toBe(1);
        });
    });
};
