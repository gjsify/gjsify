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
import { inlineStaticReads, isAbsoluteFsPath } from '@gjsify/rolldown-plugin-gjsify';

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
};
