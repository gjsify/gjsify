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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    inlineStaticReads,
    isAbsoluteFsPath,
    isWithin,
    resourceRootFor,
    shouldInline,
    shouldRewrite,
} from '@gjsify/rolldown-plugin-gjsify';

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

        await it('does NOT inline a read of the host, however static the path', () => {
            // The one that shipped. `/lib` is perfectly resolvable at build time
            // and its contents are a property of the MACHINE, so inlining freezes
            // the build host's answer into the artifact. Measured on a musl
            // aarch64 phone against the bundled CLI: `readdirSync('/lib')` gave
            // the Fedora builder's 77 entries with no `ld-musl-*` and
            // `existsSync('/lib/ld-musl-aarch64.so.1')` gave false, so
            // `detectHostLibc` answered `glibc` on a musl host and every
            // `-musl` preference downstream was inert.
            const src = `
                import { existsSync, readdirSync } from 'fs';
                const onMusl = existsSync('/lib') && readdirSync('/lib').some((f) => f.startsWith('ld-musl-'));
            `;
            const out = inlineStaticReads(src, '/home/dev/repo/packages/infra/cli/src/utils/probe.ts');
            expect(out.inlined).toBe(0);
            expect(out.contents).toContain("existsSync('/lib')");
            expect(out.contents).toContain("readdirSync('/lib')");
        });

        await it("does NOT inline a sibling package's file", () => {
            // Another package's data is not this package's resource, and a
            // hoisted tree makes it reachable by a static `..` walk.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-sibling-'));
            const reader = join(dir, 'node_modules', 'a');
            const other = join(dir, 'node_modules', 'b');
            mkdirSync(reader, { recursive: true });
            mkdirSync(other, { recursive: true });
            writeFileSync(join(reader, 'package.json'), '{"name":"a"}');
            writeFileSync(join(other, 'data.json'), '{"secret":1}');
            const src = `
                import { readFileSync } from 'fs';
                import * as path from 'node:path';
                const d = readFileSync(path.join(${JSON.stringify(other)}, 'data.json'), 'utf8');
            `;
            const out = inlineStaticReads(src, join(reader, 'index.js'));
            rmSync(dir, { recursive: true, force: true });
            expect(out.inlined).toBe(0);
        });

        await it("does NOT inline a sibling package's file spelled as a URL either", () => {
            // THE TWIN OF THE ROW ABOVE, and the reason it has to exist: the gate
            // sat after the URL branch of `evalPathExpr` had already returned, so
            // the same read declined as `path.join(<abs>)` was inlined as
            // `new URL('../../b/…', import.meta.url)` — which is not an exotic
            // spelling but the one this whole module was written for. Measured
            // before the branches were merged: `inlined: 1`, with b's bytes in the
            // output.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-sibling-url-'));
            const reader = join(dir, 'node_modules', 'a', 'lib');
            const other = join(dir, 'node_modules', 'b');
            mkdirSync(reader, { recursive: true });
            mkdirSync(other, { recursive: true });
            writeFileSync(join(dir, 'node_modules', 'a', 'package.json'), '{"name":"a"}');
            writeFileSync(join(other, 'package.json'), '{"name":"b"}');
            writeFileSync(join(other, 'data.json'), '{"secret":1}');
            const src = `
                import { readFileSync } from 'fs';
                const d = readFileSync(new URL('../../b/data.json', import.meta.url), 'utf8');
            `;
            const out = inlineStaticReads(src, join(reader, 'index.js'));
            rmSync(dir, { recursive: true, force: true });
            expect(out.inlined).toBe(0);
            expect(out.contents).toContain('../../b/data.json');
        });

        await it('DOES still inline the manifest a dual-published module reads past its own type marker', () => {
            // THE COST THE GATE MUST NOT HAVE, and it is not hypothetical: a
            // package that publishes both formats drops a `{"type":"commonjs"}`
            // marker beside the emitted output, and that marker IS a
            // `package.json`. Answering "the nearest one" would put the resource
            // root at `dist/cjs` and decline the module's read of its OWN manifest
            // one level up — leaving live in the bundle exactly the read this file
            // exists to remove. Measured in this repo's installed tree:
            // `engine.io-client/build/{cjs,esm}` and
            // `@socket.io/component-emitter/lib/cjs` are that shape.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-dual-'));
            const pkg = join(dir, 'node_modules', 'dual');
            mkdirSync(join(pkg, 'dist', 'cjs'), { recursive: true });
            writeFileSync(join(pkg, 'package.json'), '{"name":"dual","version":"7.7.7"}');
            writeFileSync(join(pkg, 'dist', 'cjs', 'package.json'), '{"type":"commonjs"}');
            const src = `
                import { readFileSync } from 'fs';
                import { fileURLToPath } from 'url';
                const v = readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8');
            `;
            const out = inlineStaticReads(src, join(pkg, 'dist', 'cjs', 'index.js'));
            rmSync(dir, { recursive: true, force: true });
            expect(out.inlined).toBe(1);
            expect(out.contents).toContain('7.7.7');
        });

        await it("DOES still inline the package's own resource", () => {
            // The happy path the gate must not cost: a package reading its own
            // file through `import.meta.url`, which is the whole reason this
            // module exists.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-own-'));
            mkdirSync(join(dir, 'lib'), { recursive: true });
            writeFileSync(join(dir, 'package.json'), '{"name":"own","version":"9.9.9"}');
            const src = `
                import { readFileSync } from 'fs';
                const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
            `;
            const out = inlineStaticReads(src, join(dir, 'lib', 'index.js'));
            rmSync(dir, { recursive: true, force: true });
            expect(out.inlined).toBe(1);
            expect(out.contents).toContain('9.9.9');
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
    await describe('isWithin', async () => {
        await it('accepts the root itself and a descendant', () => {
            expect(isWithin('/a/b', '/a/b', 'linux')).toBe(true);
            expect(isWithin('/a/b/c/d.json', '/a/b', 'linux')).toBe(true);
        });

        await it('rejects an ancestor and a sibling', () => {
            expect(isWithin('/a', '/a/b', 'linux')).toBe(false);
            expect(isWithin('/a/c', '/a/b', 'linux')).toBe(false);
        });

        await it("rejects a sibling whose name EXTENDS the root — the string test's bug", () => {
            // `startsWith` calls /lib64 a child of /lib. It is not one.
            expect(isWithin('/lib64/x.so', '/lib', 'linux')).toBe(false);
        });

        await it('works on win32 paths', () => {
            expect(isWithin('C:\\ws\\pkg\\data.json', 'C:\\ws\\pkg', 'win32')).toBe(true);
            expect(isWithin('C:\\ws\\other\\data.json', 'C:\\ws\\pkg', 'win32')).toBe(false);
        });
    });

    // Two rules, because "the reading module's package" is a different question for
    // an installed file than for a first-party one, and one answer gets the other
    // wrong. The pair below is what says so.
    await describe('resourceRootFor', async () => {
        await it('is the nearest ancestor carrying a package.json, for a first-party file', () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-root-'));
            mkdirSync(join(dir, 'pkg', 'src', 'deep'), { recursive: true });
            writeFileSync(join(dir, 'pkg', 'package.json'), '{"name":"p"}');
            expect(resourceRootFor(join(dir, 'pkg', 'src', 'deep', 'x.ts'))).toBe(join(dir, 'pkg'));
            rmSync(dir, { recursive: true, force: true });
        });

        await it('is the NEAREST one and not the outermost, so a monorepo package is not the workspace', () => {
            // The outermost would be the workspace root, and one package could then
            // inline its siblings' files.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-ws-'));
            mkdirSync(join(dir, 'packages', 'a', 'src'), { recursive: true });
            writeFileSync(join(dir, 'package.json'), '{"name":"ws","workspaces":["packages/*"]}');
            writeFileSync(join(dir, 'packages', 'a', 'package.json'), '{"name":"a"}');
            expect(resourceRootFor(join(dir, 'packages', 'a', 'src', 'x.ts'))).toBe(join(dir, 'packages', 'a'));
            rmSync(dir, { recursive: true, force: true });
        });

        await it('is the node_modules package directory for an installed file, marker package.json or not', () => {
            // Structural, not probed: a `{"type":"commonjs"}` marker deeper in the
            // tree must not become the root — see the dual-publish row above.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-installed-'));
            const pkg = join(dir, 'node_modules', 'dual');
            mkdirSync(join(pkg, 'dist', 'cjs'), { recursive: true });
            writeFileSync(join(pkg, 'package.json'), '{"name":"dual"}');
            writeFileSync(join(pkg, 'dist', 'cjs', 'package.json'), '{"type":"commonjs"}');
            expect(resourceRootFor(join(pkg, 'dist', 'cjs', 'index.js'))).toBe(pkg);
            rmSync(dir, { recursive: true, force: true });
        });

        await it('keeps a scoped name whole, and takes the LAST node_modules on the way up', () => {
            // A nested dependency and a scoped one must resolve to THEMSELVES, not
            // to whatever contains them — the property a Yarn-PnP zip path depends
            // on as much as a hoisted tree does.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-scoped-'));
            const scoped = join(dir, 'node_modules', '@scope', 'name');
            const nested = join(dir, 'node_modules', 'a', 'node_modules', 'b');
            mkdirSync(join(scoped, 'lib'), { recursive: true });
            mkdirSync(join(nested, 'lib'), { recursive: true });
            expect(resourceRootFor(join(scoped, 'lib', 'x.js'))).toBe(scoped);
            expect(resourceRootFor(join(nested, 'lib', 'x.js'))).toBe(nested);
            rmSync(dir, { recursive: true, force: true });
        });

        await it("falls back to the module's own directory when nothing above declares one", () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-noroot-'));
            // Nothing under `dir` carries a package.json. Whatever the walk finds
            // above it, the answer must still contain the module itself, which is
            // what the fallback guarantees.
            expect(isWithin(join(dir, 'x.js'), resourceRootFor(join(dir, 'x.js')))).toBe(true);
            rmSync(dir, { recursive: true, force: true });
        });
    });

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
