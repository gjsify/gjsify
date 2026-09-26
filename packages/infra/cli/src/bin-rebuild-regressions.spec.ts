// Regressions for the four `--app gjs` build defects `gjsify exec` exposed on the first
// real bins it rebuilt (ADR 0076). Each one failed a whole build — or shipped a bundle
// that died at load — for a package that does nothing unusual:
//
//   1. `console = …` in a sloppy dependency (node-forge, via web-ext and wxt):
//      `ASSIGN_TO_IMPORT: Cannot assign to import 'console'`, because the console
//      `inject` turns every free `console` into an import binding.
//   2. `"import.meta.url"` as a STRING (vite's and wxt's `define` keys): the path
//      rewriter replaced the token inside the quotes and produced
//      `"__gjsifyModuleUrl("vite/…")"` — `PARSE_ERROR: Expected ':' but found Identifier`.
//   3. A `.cjs` entry (prettier's `bin/prettier.cjs`): the virtual entry wrapper kept
//      the extension, so Rolldown parsed the ESM wrapper as CommonJS.
//   4. A consumer with no `@gjsify/*` installed: the `--globals auto` gate dropped every
//      register the toolchain resolver would have supplied.
//
// Pure-function rows: each asserts the fixed decision directly, so a regression names
// its cause instead of surfacing as a failed third-party build.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acorn from 'acorn';
import {
    bindConsoleLocally,
    CONSOLE_LOCAL_BINDING,
    rewriteContents,
    wrapInputWithSideEffects,
} from '@gjsify/rolldown-plugin-gjsify';
import { isRegisterPathResolvable } from '@gjsify/rolldown-plugin-gjsify/globals';

function parses(code: string, sourceType: 'module' | 'script'): boolean {
    try {
        acorn.parse(code, { ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true });
        return true;
    } catch {
        return false;
    }
}

export default async () => {
    await describe('console inject: a module assigning the global console', async () => {
        await it('gets a local binding (the node-forge shape)', () => {
            const src = "if (typeof console === 'undefined') {\n  console = { log: function() {} };\n}\n";
            const out = bindConsoleLocally(src);
            expect(out).toBe(`${CONSOLE_LOCAL_BINDING}${src}`);
            expect(parses(out!, 'script')).toBe(true);
        });

        await it('keeps a directive prologue first, ASI or not', () => {
            const out = bindConsoleLocally("'use strict'\nconsole = {};\n");
            expect(out!.startsWith("'use strict';" + CONSOLE_LOCAL_BINDING)).toBe(true);
            expect(parses(out!, 'script')).toBe(true);
        });

        await it('leaves every module that does not assign it alone', () => {
            // A default parameter is a binding (vite's `console = globalThis.console`).
            expect(bindConsoleLocally('function f(console = globalThis.console) { console.log(1) }')).toBe(null);
            expect(bindConsoleLocally('const console = makeLogger(); console.log(1);')).toBe(null);
            expect(bindConsoleLocally('console.log = () => {};')).toBe(null);
            expect(bindConsoleLocally('x.console = 1;')).toBe(null);
            expect(bindConsoleLocally('if (console == null) {}')).toBe(null);
            expect(bindConsoleLocally('const f = console => console;')).toBe(null);
        });

        await it('does not declare a second binding beside an existing one', () => {
            // Declared AND assigned: a second `var` would collide with the `let`.
            expect(bindConsoleLocally('let console; console = {};')).toBe(null);
        });
    });

    await describe('node_modules path rewrite: import.meta.url in a string', async () => {
        const path = '/p/node_modules/vite/dist/node/chunks/node.js';

        await it('rewrites the expression and leaves the string key alone', () => {
            const src = 'const define = { "import.meta.url": name };\nexport const here = import.meta.url;\n';
            const out = rewriteContents({ path }, src, '/p/dist', true)!.code;
            expect(out).toContain('{ "import.meta.url": name }');
            expect(out).toContain('export const here = __gjsifyModuleUrl("vite/dist/node/chunks/node.js");');
            expect(parses(out, 'module')).toBe(true);
        });

        await it('answers import.meta.dirname and .filename, which GJS does not define', () => {
            // unplugin: `path.resolve(import.meta.dirname, "rspack/loaders/…")`.
            const src = 'export const d = import.meta.dirname;\nexport const f = import.meta.filename;\n';
            const out = rewriteContents({ path }, src, '/p/dist', true)!.code;
            expect(out).toContain('export const d = __gjsifyModuleDir("vite/dist/node/chunks/node.js");');
            expect(out).toContain('export const f = __gjsifyModuleFile("vite/dist/node/chunks/node.js");');
            expect(out).toContain('__gjsifyModuleDir, __gjsifyModuleFile');
            expect(out).not.toContain('import.meta');
            expect(parses(out, 'module')).toBe(true);
        });

        await it('does the same on the build-relative (non-ESM output) path', () => {
            const src = "const k = 'import.meta.url';\nconst u = import.meta.url;\n";
            const out = rewriteContents({ path }, src, '/p/dist', false)!.code;
            expect(out).toContain("const k = 'import.meta.url';");
            expect(out).toContain('const u = new URL(');
            expect(parses(out, 'module')).toBe(true);
        });
    });

    await describe('virtual entry wrapper: a CommonJS entry', async () => {
        await it('gives the wrapper of a .cjs entry an ESM id', () => {
            const { input } = wrapInputWithSideEffects('/p/bin/prettier.cjs', ['/p/inject.mjs']);
            expect(String(input).endsWith('.cjs.mjs')).toBe(true);
        });

        await it('keeps every other id as it was', () => {
            const { input } = wrapInputWithSideEffects('/p/src/index.ts', ['/p/inject.mjs']);
            expect(String(input).endsWith('/p/src/index.ts')).toBe(true);
        });
    });

    await describe('--globals auto gate: the toolchain as a second root', async () => {
        await it('accepts a register only the toolchain root provides', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-register-roots-'));
            try {
                const project = join(root, 'project');
                const toolchain = join(root, 'cli');
                mkdirSync(project, { recursive: true });
                mkdirSync(join(toolchain, 'node_modules', '@gjsify', 'buffer'), { recursive: true });
                writeFileSync(join(toolchain, 'node_modules', '@gjsify', 'buffer', 'package.json'), '{}');
                expect(isRegisterPathResolvable('@gjsify/buffer/register', project)).toBe(false);
                expect(isRegisterPathResolvable('@gjsify/buffer/register', [project, toolchain])).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
