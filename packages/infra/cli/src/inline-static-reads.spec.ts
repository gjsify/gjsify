// Regression coverage for the build-time `readFileSync`/`readdirSync`
// inliner in @gjsify/rolldown-plugin-gjsify. The inliner statically
// evaluates `path.join(...)` / `fileURLToPath(...)` / `new URL(...)`
// compositions to resolve the filesystem path argument, then replaces
// the call with the read result.
//
// We protect three behaviours:
//
// 1. `arr.join('/')` (Array.prototype.join) is NOT misread as `path.join('/')`
//    — that bug inlined `fs.readdirSync('/', {withFileTypes:true})` (root
//    of the build machine!) as a string array, which then crashed TypeDoc
//    at runtime via `child.isFile is not a function`. The MemberExpression
//    callee must have a known module-namespace object (`path` / `fs`).
//
// 2. `readdirSync(dir, { withFileTypes: true })` is NOT inlined, since
//    we'd replace Dirent[] with string[] — defence in depth against
//    static path-resolution paths we haven't envisioned yet.
//
// 3. `path.join('a', 'b')` + `readdirSync(staticPath)` (no opts) STILL
//    inline — the inliner's legitimate happy path must keep working,
//    otherwise we lose the `import.meta.url`-resolved-package-data
//    bundling for `package.json`, locale files, etc.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineStaticReads, isAbsoluteFsPath, shouldInline, shouldRewrite } from '@gjsify/rolldown-plugin-gjsify';

export default async () => {
    await describe('inline-static-reads', async () => {
        await it('does NOT inline readdirSync when first arg is Array.prototype.join', () => {
            // Mirrors typedoc's discoverFiles: `dir` is a string[][] local,
            // `dir.join('/')` is Array.prototype.join(), NOT path.join().
            const src = `
                import { readdirSync } from 'fs';
                function discover(dir) {
                    for (const c of readdirSync(dir.join('/'), { withFileTypes: true })) {
                        if (c.isFile()) console.log(c.name);
                    }
                }
            `;
            const out = inlineStaticReads(src, '/tmp/foo.js');
            expect(out.inlined).toBe(0);
            // The original call must remain — no rewrite to a string array.
            expect(out.contents).toContain("readdirSync(dir.join('/'), { withFileTypes: true })");
        });

        await it('does NOT inline readdirSync with { withFileTypes: true } even when path resolves', () => {
            const src = `
                import { readdirSync } from 'fs';
                import { join } from 'node:path';
                const entries = readdirSync(join('/tmp'), { withFileTypes: true });
            `;
            const out = inlineStaticReads(src, '/tmp/foo.js');
            expect(out.inlined).toBe(0);
            expect(out.contents).toContain('readdirSync(join(');
        });

        await it('does inline a bare readdirSync(path.join(...)) call with no opts', () => {
            // path.join over string literals is a legitimate static path —
            // and the call has no `withFileTypes` so a string[] result is
            // exactly what the consumer expects.
            // A directory this test CREATES, rather than `/tmp`: the inliner
            // only rewrites a call whose resolved path actually exists, and
            // `/tmp` does not on Windows (`path.join('/tmp')` is `\tmp` there),
            // so the happy path silently became the decline path and the row
            // asserted nothing about the inliner. `JSON.stringify` supplies the
            // literal because a Windows path is full of backslashes that would
            // otherwise become escapes in the generated source.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-inline-'));
            writeFileSync(join(dir, 'entry.txt'), 'x');
            const src = `
                import { readdirSync } from 'fs';
                import * as path from 'node:path';
                const names = readdirSync(path.join(${JSON.stringify(dir)}));
            `;
            const out = inlineStaticReads(src, join(dir, 'foo.js'));
            rmSync(dir, { recursive: true, force: true });
            expect(out.inlined).toBe(1);
            // The replacement must be an array literal (or at minimum no
            // longer contain the readdirSync call itself).
            expect(out.contents).not.toContain('readdirSync(path.join');
            expect(out.contents).toMatch(/\[\s*"/);
        });

        await it('does NOT misread arbitrary `.join` as `path.join` (no inlining)', () => {
            // `someArr.join('/')` must not be evaluated as `path.join`.
            // We use it here as the second positional arg of an unrelated
            // call to confirm the evaluator just bails out.
            const src = `
                import { readFileSync } from 'fs';
                const segments = ['a', 'b'];
                const data = readFileSync(segments.join('/'));
            `;
            const out = inlineStaticReads(src, '/tmp/foo.js');
            expect(out.inlined).toBe(0);
            expect(out.contents).toContain("readFileSync(segments.join('/'))");
        });
    });

    // The last gate before a resolved expression is read from disk. It was
    // `startsWith('/')`, which is the right test for exactly one platform: on
    // Windows every path this evaluator produces is `C:\…`, so the two
    // documented compositions that reduce to a path STRING —
    // `fileURLToPath(new URL(…))` and `path.join(__dirname)` — were silently
    // never inlined there. `platform` is injected, so both branches run on
    // every host; off win32 this regression is otherwise invisible.
    await describe('isAbsoluteFsPath', async () => {
        await it('accepts a POSIX absolute path, rejects a relative one', () => {
            expect(isAbsoluteFsPath('/tmp/x.json', 'linux')).toBe(true);
            expect(isAbsoluteFsPath('tmp/x.json', 'linux')).toBe(false);
            expect(isAbsoluteFsPath('./x.json', 'linux')).toBe(false);
        });

        await it('accepts a drive-letter path on win32 — the case that was dropped', () => {
            expect(isAbsoluteFsPath('C:\\ws\\pkg\\package.json', 'win32')).toBe(true);
            expect(isAbsoluteFsPath('C:/ws/pkg/package.json', 'win32')).toBe(true);
        });

        await it('accepts a UNC path on win32', () => {
            expect(isAbsoluteFsPath('\\\\server\\share\\x.json', 'win32')).toBe(true);
        });

        await it('rejects a relative path on win32 too', () => {
            expect(isAbsoluteFsPath('ws\\pkg\\package.json', 'win32')).toBe(false);
            expect(isAbsoluteFsPath('..\\x.json', 'win32')).toBe(false);
        });

        await it('does NOT accept a drive-letter path off win32', () => {
            // On POSIX `C:\…` is a single relative filename, not a path — the
            // old `startsWith('/')` said so and that must not change.
            expect(isAbsoluteFsPath('C:\\ws\\x.json', 'linux')).toBe(false);
        });
    });

    // The inliner was scoped to `node_modules` and parsed with plain acorn. Both
    // halves hid the same thing, and only together: an installed package ships
    // JS, so acorn could always parse what the scope let through, and no test
    // ever handed it a `.ts`. The result was that every first-party static read
    // in this repository stayed live in the GJS bundle — including six template
    // loaders in @gjsify/cli itself, two of which carry a comment claiming the
    // inliner handles them. `gjs -m dist/cli.gjs.mjs ship --stage` died with
    // ENOENT on `templates/app/desktop.tmpl` while `node lib/index.js ship
    // --stage` staged it fine.
    //
    // The discriminator is the pair below: the SAME expression, once as .js and
    // once as .ts. Before the fix the first returned 1 and the second 0, and a 0
    // is indistinguishable from "this file has no static reads" — which is why
    // nothing noticed for as long as it did.
    await describe('inline-static-reads — TypeScript sources', async () => {
        await it('inlines the same expression from .ts as from .js', () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-inline-ts-'));
            try {
                writeFileSync(join(dir, 'greeting.txt'), 'from-a-typescript-source');
                const read = `readFileSync(new URL('./greeting.txt', import.meta.url), 'utf-8')`;
                const js = `import { readFileSync } from 'node:fs';\nexport const greeting = ${read};\n`;
                // A type annotation and an interface: the syntax acorn rejects,
                // and the reason the whole file was skipped rather than partly read.
                const ts =
                    `import { readFileSync } from 'node:fs';\n` +
                    `interface Unused { readonly a: string }\n` +
                    `export const greeting: string = ${read};\n`;

                const asJs = inlineStaticReads(js, join(dir, 'probe.js'));
                const asTs = inlineStaticReads(ts, join(dir, 'probe.ts'));

                expect(asJs.inlined).toBe(1);
                expect(asTs.inlined).toBe(1);
                expect(asTs.contents).toContain('from-a-typescript-source');
                // The call itself is gone, not merely repointed.
                expect(asTs.contents.includes('readFileSync(new URL(')).toBe(false);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('leaves a genuinely unparseable source alone instead of throwing', () => {
            const out = inlineStaticReads('const a = <<< readFileSync', '/tmp/broken.ts');
            expect(out.inlined).toBe(0);
        });
    });

    // Two questions, two predicates. Collapsing them is what trapped the inliner
    // inside the rewriter's scope; keeping them apart is what the plugin's
    // `shouldInline` doc block argues for at length.
    await describe('shouldInline is wider than shouldRewrite, deliberately', async () => {
        await it('accepts a first-party source the rewriter skips', () => {
            const firstParty = '/project/src/utils/app-metadata.ts';
            expect(shouldInline(firstParty)).toBe(true);
            expect(shouldRewrite(firstParty)).toBe(false);
        });

        await it('accepts an installed package too — the rewriter is not narrowed', () => {
            const installed = '/project/node_modules/typedoc/dist/lib/app.js';
            expect(shouldInline(installed)).toBe(true);
            expect(shouldRewrite(installed)).toBe(true);
        });

        await it('still refuses our own shims, which must never be touched', () => {
            const shim = '/p/node_modules/@gjsify/rolldown-plugin-gjsify/lib/shims/module-resolve.js';
            expect(shouldInline(shim)).toBe(false);
            expect(shouldRewrite(shim)).toBe(false);
        });

        await it('refuses a path that is not a source at all', () => {
            expect(shouldInline('/project/src/data.json')).toBe(false);
            expect(shouldInline('/project/src/templates/app/desktop.tmpl')).toBe(false);
        });
    });
};
