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
import { inlineStaticReads } from '@gjsify/rolldown-plugin-gjsify';

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
            const src = `
                import { readdirSync } from 'fs';
                import * as path from 'node:path';
                const names = readdirSync(path.join('/tmp'));
            `;
            const out = inlineStaticReads(src, '/tmp/foo.js');
            // /tmp exists on every POSIX build host; one inline expected.
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
};
