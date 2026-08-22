// Build-time inlining of statically-resolvable filesystem reads.
//
// Many node_modules packages locate their own resources (own package.json,
// locales, themes, ...) via `import.meta.url`-relative reads:
//
//   const pkg = JSON.parse(readFileSync(
//     new URL("../package.json", import.meta.url),
//     "utf8",
//   ));
//
// In a bundled GJS executable, `import.meta.url` no longer points at the
// original `node_modules/<pkg>/<file>` location, so the read fails with
// ENOENT once the bundle leaves the build site (gjsify dlx, manual move,
// CI artifact download, …).
//
// The clean fix is to evaluate the static expressions at build time and
// replace the entire `readFileSync(...)` (or `readdirSync(...)`, or the
// `JSON.parse(readFileSync(...))` composition) with a literal containing
// the file contents. The bundle is then a single self-contained file that
// behaves exactly like the original — same return value, same errors on
// missing files — but with no runtime dependency on the build-site layout.
//
// Patterns handled:
//
//   readFileSync(<URL-derived-path>, "utf8" | "utf-8" | { encoding: "utf8" })
//                                                       → string literal
//   readFileSync(<URL-derived-path>)                    → Uint8Array literal
//   readdirSync(<URL-derived-path>)                     → array literal of names
//   JSON.parse(readFileSync(...))                       → object literal
//   existsSync(<URL-derived-path>)                      → boolean literal
//
// Path expressions are evaluated against `import.meta.url` of the source
// file at build time, supporting compositions of:
//
//   new URL(<lit>, import.meta.url)                     base resolution
//   <expr>.href, <expr>.pathname                        property access
//   fileURLToPath(<URL-expr>)                           url → fs path
//   path.{join,dirname,resolve,basename,relative}(...)  path arithmetic
//   string-literal + string-literal                     concatenation
//
// Anything not statically resolvable is left untouched — the legacy
// `import.meta.url` rewriter still applies as a fallback.

import * as acorn from 'acorn';
import { tsPlugin } from 'acorn-typescript';
import { dirname, join, resolve, basename, relative, extname, posix, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

/**
 * One in-place edit on the source string. Stored as half-open `[start, end)`
 * byte offsets so we can apply replacements right-to-left without invalidating
 * earlier offsets.
 */
interface Edit {
    start: number;
    end: number;
    replacement: string;
}

interface InlineContext {
    /** `import.meta.url` of the source file being inlined (file:// URL). */
    sourceUrl: string;
}

/**
 * Run the inliner on a source string. Returns the rewritten source (or the
 * original string when no inlining applied) and the count of edits applied.
 *
 * Safe to call on any JS source. Files that don't reference `readFileSync` /
 * `readdirSync` / `existsSync` skip the AST parse entirely (cheap fast path).
 */
const TS_EXT_RE = /\.[cm]?tsx?$/i;

/**
 * The TypeScript-capable parser, built once.
 *
 * `acorn-typescript` and not the bundler's own parser, and the reason is the
 * runtime rather than a preference: under GJS the engine is
 * `@gjsify/rolldown-native`, and npm `rolldown` is "a Rust napi crate that cannot
 * run under GJS" (`bundler-pick.ts`), loaded only behind a dynamic import on Node.
 * A top-level `import { parseAst } from 'rolldown/parseAst'` therefore links a
 * Node-only N-API package into a module that has to load under GJS — measured:
 * the CLI's own bundle then died at startup with `createRequire: Cannot require
 * builtin module "fs" synchronously in GJS`. `acorn-typescript` is pure JS, emits
 * the same ESTree shapes the evaluator below already speaks, and needs
 * `locations: true` (it refuses to parse without them).
 */
const TS_PARSER = acorn.Parser.extend(tsPlugin() as never);

/**
 * Parse a source with the parser its extension calls for.
 *
 * The TypeScript half is why first-party sources were invisible to this inliner
 * for as long as it was scoped to `node_modules`: an installed package ships JS,
 * so plain acorn could always parse it, and nothing ever asked what happens to a
 * `.ts`. The answer was that `acorn.parse` threw and the `catch` returned
 * "nothing to inline" — a result indistinguishable from a file that genuinely has
 * no static reads. Measured on `packages/infra/cli/src/utils/app-metadata.ts`:
 * `inlined: 0`, while the identical expression in a `.js` file returned
 * `inlined: 1`.
 */
function parseSource(src: string, sourceFilePath: string): acorn.Program {
    const shared = {
        ecmaVersion: 'latest' as const,
        sourceType: 'module' as const,
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true,
    };
    if (!TS_EXT_RE.test(sourceFilePath)) return acorn.parse(src, shared);
    return TS_PARSER.parse(src, { ...shared, locations: true }) as acorn.Program;
}

/**
 * Visit every `CallExpression` in the tree.
 *
 * A generic descent rather than `acorn-walk`, and that is not a preference:
 * `walk.simple` looks its visitor up in a table keyed by node type and throws
 * `No walker function defined for node type TSInterfaceDeclaration` on the first
 * interface in a first-party source. A walker with no node table cannot fall
 * behind the parser — which matters precisely because the parser is now allowed
 * to emit node types this file has never heard of.
 */
function forEachCallExpression(root: unknown, visit: (node: acorn.CallExpression) => void): void {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node === null || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
            for (const child of node) stack.push(child);
            continue;
        }
        if ((node as { type?: unknown }).type === 'CallExpression') visit(node as acorn.CallExpression);
        for (const value of Object.values(node)) {
            if (value !== null && typeof value === 'object') stack.push(value);
        }
    }
}

export function inlineStaticReads(src: string, sourceFilePath: string): { contents: string; inlined: number } {
    if (!src.includes('readFileSync') && !src.includes('readdirSync') && !src.includes('existsSync')) {
        return { contents: src, inlined: 0 };
    }

    let ast: acorn.Program;
    try {
        ast = parseSource(src, sourceFilePath);
    } catch {
        // Not parseable as the language its extension claims (a CJS source with
        // a shebang, mixed module syntax, ...). Skip; the rest of the rewriter
        // still runs. This catch used to swallow every TypeScript file in the
        // tree as well — see `parseSource`.
        return { contents: src, inlined: 0 };
    }

    const ctx: InlineContext = {
        sourceUrl: pathToFileURL(sourceFilePath).href,
    };
    const edits: Edit[] = [];

    forEachCallExpression(ast, (node) => {
        const edit = tryInlineCall(node, ctx, src);
        if (edit) edits.push(edit);
    });

    if (edits.length === 0) return { contents: src, inlined: 0 };

    // The walker visits both outer and inner CallExpressions, so a successful
    // match on `JSON.parse(readFileSync(...))` produces an edit AT the same
    // time that the inner `readFileSync(...)` also produces one. Applying both
    // would corrupt the output. Keep only edits that are not contained in any
    // other edit (= outermost wins).
    const outermost: Edit[] = [];
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    for (const e of edits) {
        const last = outermost[outermost.length - 1];
        if (last && e.start >= last.start && e.end <= last.end) continue; // nested
        outermost.push(e);
    }

    // Apply right-to-left so earlier offsets remain valid.
    outermost.sort((a, b) => b.start - a.start);
    let out = src;
    for (const e of outermost) {
        out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    }
    return { contents: out, inlined: outermost.length };
}

/**
 * Try to inline a single `CallExpression`. Returns an edit on success, or
 * `undefined` if the call doesn't match an inlinable pattern or the path
 * couldn't be resolved or the file doesn't exist.
 */
function tryInlineCall(node: acorn.CallExpression, ctx: InlineContext, _src: string): Edit | undefined {
    const callee = node.callee;

    // `JSON.parse(readFileSync(<path>, "utf8"))` — collapse the whole
    // composition. Recognising it specifically lets us emit a parsed-JSON
    // object literal instead of a `JSON.parse('…')` string-then-parse pair,
    // which esbuild can dead-code-eliminate against.
    if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'JSON' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'parse' &&
        node.arguments.length >= 1 &&
        node.arguments[0].type === 'CallExpression'
    ) {
        const inner = node.arguments[0] as acorn.CallExpression;
        const innerEdit = tryInlineReadFile(inner, ctx, /*forceTextEncoding*/ true);
        if (innerEdit !== undefined) {
            // `innerEdit` is the literal source for the read result (a JSON
            // string). Parse and re-emit as a JS-literal expression so the
            // surrounding code sees an object directly.
            try {
                const parsed = JSON.parse(JSON.parse(innerEdit));
                return {
                    start: node.start,
                    end: node.end,
                    replacement: jsLiteral(parsed),
                };
            } catch {
                // Fall through — leave the original call alone.
            }
        }
    }

    const calleeName = identifierName(callee);

    if (calleeName === 'readFileSync') {
        const replacement = tryInlineReadFile(node, ctx, /*forceTextEncoding*/ false);
        if (replacement !== undefined) {
            return { start: node.start, end: node.end, replacement };
        }
    }

    if (calleeName === 'readdirSync') {
        // We inline as a plain string[] — refuse if the caller asks for
        // Dirent[] via { withFileTypes: true }. Otherwise the consumer's
        // child.isFile() call would throw at runtime ("isFile is not a
        // function" on a string).
        if (hasWithFileTypes(node.arguments[1])) return undefined;
        const path = evalPathExpr(node.arguments[0], ctx);
        if (path && existsSync(path) && isDirectorySafe(path)) {
            try {
                const names = readdirSync(path);
                return {
                    start: node.start,
                    end: node.end,
                    replacement: jsLiteral(names),
                };
            } catch {
                /* skip */
            }
        }
    }

    if (calleeName === 'existsSync') {
        const path = evalPathExpr(node.arguments[0], ctx);
        if (path !== undefined) {
            return {
                start: node.start,
                end: node.end,
                replacement: existsSync(path) ? 'true' : 'false',
            };
        }
    }

    // `createRequire(<URL>)` from `node:module` returns a CJS-style require.
    // In a bundled GJS executable, the deps that the runtime require would
    // resolve are already inlined by esbuild, so the require() function is
    // typically dead code. The createRequire CALL itself runs at module init,
    // and Node's implementation rejects the rewritten URLs we produce when
    // they don't point at an existing file (yargs-parser's `createRequire(
    // import.meta.url)` blows up because the rewritten URL refers to a Yarn
    // PnP zip path that doesn't exist outside the PnP runtime).
    //
    // Replace the call with a stub function: assignment succeeds, the bundle
    // boots, and any actual `require()` invocation produces a clear error
    // instead of an obscure URL-validation crash. Only fires when the URL
    // argument can be statically resolved AND points at a non-existent file
    // — the common case is exactly the broken one.
    if (calleeName === 'createRequire') {
        const path = evalPathExpr(node.arguments[0], ctx);
        // Stub the call when:
        //  - the resolved path doesn't exist on disk (build site), OR
        //  - the path contains a `.zip/` segment (Yarn PnP virtual zip,
        //    where Node's PnP hooks make `existsSync` return true at build
        //    time but the path doesn't exist under GJS at runtime).
        const isZip = path !== undefined && path.includes('.zip/');
        if (path !== undefined && (isZip || !existsSync(path))) {
            return {
                start: node.start,
                end: node.end,
                replacement:
                    `(() => { ` +
                    `const _r = (id) => { throw new Error("[gjsify] createRequire stub: '" + id + "' was not bundled (anchor path: " + ${jsStringLiteral(path)} + ")"); }; ` +
                    `_r.resolve = _r; _r.cache = {}; _r.extensions = {}; _r.main = void 0; ` +
                    `return _r; ` +
                    `})()`,
            };
        }
    }

    return undefined;
}

/**
 * Inline a `readFileSync(<path>, <enc>?)` call to a string or byte literal.
 * Returns the source replacement, or `undefined` to leave the call alone.
 *
 * `forceTextEncoding`: caller (JSON.parse wrapper) demands an utf-8 read
 * regardless of whether the syntactic argument provides an encoding.
 */
function tryInlineReadFile(
    node: acorn.CallExpression,
    ctx: InlineContext,
    forceTextEncoding: boolean,
): string | undefined {
    if (node.arguments.length < 1) return undefined;
    const path = evalPathExpr(node.arguments[0], ctx);
    if (!path) return undefined;
    if (!existsSync(path) || isDirectorySafe(path)) return undefined;

    let encoding: string | undefined;
    if (forceTextEncoding) {
        encoding = 'utf8';
    } else if (node.arguments.length >= 2) {
        encoding = evalEncodingExpr(node.arguments[1]);
        if (encoding === undefined) return undefined; // unknown → bail
    }

    try {
        if (encoding) {
            const text = readFileSync(path, encoding as BufferEncoding);
            return jsStringLiteral(text);
        } else {
            // Binary read → emit a Uint8Array constructor over a number array.
            // Buffer-vs-Uint8Array semantic difference is mostly irrelevant in
            // bundled GJS code (Buffer is polyfilled on top of Uint8Array).
            const bytes = readFileSync(path);
            return `new Uint8Array([${Array.from(bytes).join(',')}])`;
        }
    } catch {
        return undefined;
    }
}

/**
 * Statically evaluate a node we expect to produce a filesystem path string.
 * Returns the absolute path or `undefined` if any step is non-static.
 *
 * Recursively understands compositions of:
 *   - string literals, template literals (no expressions), `+` concatenation
 *   - `new URL(<lit>, <base-url-expr>)`
 *   - `<URL-expr>.href`, `<URL-expr>.pathname`
 *   - `fileURLToPath(<URL-expr>)` / `pathToFileURL(<path>).href`
 *   - `(path.)?{join,dirname,resolve,basename,relative,extname}(...)` over static args
 *   - `import.meta.url` (resolved against ctx.sourceUrl)
 *   - bare identifier `__dirname` / `__filename` (resolved against ctx.sourceUrl)
 *
 * Returns a path string OR a URL string, depending on context — callers
 * that need a path use `evalPathExpr`, callers that need a URL use
 * `evalUrlExpr`. They both come from the same recursive evaluator.
 */
function evalPathExpr(node: acorn.AnyNode | undefined, ctx: InlineContext): string | undefined {
    const v = evalExpr(node, ctx);
    if (v instanceof URL) {
        if (v.protocol === 'file:') return fileURLToPath(v);
        return undefined;
    }
    if (typeof v !== 'string') return undefined;
    if (v.startsWith('file://')) return fileURLToPath(v);
    if (isAbsoluteFsPath(v)) return v;
    return undefined;
}

/**
 * Is `v` an absolute filesystem path on `platform`?
 *
 * This is the last gate before a resolved expression is read from disk, and it
 * used to be `v.startsWith('/')`. That is the right test for exactly one
 * platform. On Windows every path this evaluator produces is `C:\…` — both
 * documented compositions land there:
 *
 *     readFileSync(fileURLToPath(new URL('./x.txt', import.meta.url)), 'utf8')
 *     readdirSync(path.join(__dirname))
 *
 * so both returned `undefined` and the call was left un-inlined. Silently: no
 * warning, no error, just a bundle that keeps a runtime `readFileSync` against
 * a build-site path and throws ENOENT the moment it is moved — which is the one
 * failure this whole module exists to prevent (see the header). It also means
 * the same source could bundle to DIFFERENT bytes on Windows than on Linux.
 *
 * Measured on win32 x64: the four `new URL(…)` patterns inline there correctly
 * (the URL branch above never went through this gate); only the two that reduce
 * to a path STRING were affected. No call site in this repo composes them
 * inline today — every one goes through an intermediate variable, which the
 * evaluator cannot follow on any platform — so no committed bundle is known to
 * differ. This closes the gap before it opens.
 *
 * `platform` is injected and the branches use `path.win32`/`path.posix`
 * explicitly, so both are exercised from either host — the same shape
 * `extractPackageSpec` and `utils/entry-points.ts` use. On POSIX
 * `posix.isAbsolute` IS `startsWith('/')`, so behaviour there is unchanged.
 */
export function isAbsoluteFsPath(v: string, platform: string = process.platform): boolean {
    return (platform === 'win32' ? win32 : posix).isAbsolute(v);
}

type EvalValue = string | URL | undefined;

function evalExpr(node: acorn.AnyNode | undefined, ctx: InlineContext): EvalValue {
    if (!node) return undefined;

    switch (node.type) {
        case 'Literal':
            if (typeof (node as acorn.Literal).value === 'string') {
                return (node as acorn.Literal).value as string;
            }
            return undefined;

        case 'TemplateLiteral': {
            const tl = node as acorn.TemplateLiteral;
            if (tl.expressions.length > 0) return undefined;
            return tl.quasis.map((q) => q.value.cooked ?? '').join('');
        }

        case 'BinaryExpression': {
            const be = node as acorn.BinaryExpression;
            if (be.operator !== '+') return undefined;
            const l = evalExpr(be.left, ctx);
            const r = evalExpr(be.right, ctx);
            if (typeof l !== 'string' || typeof r !== 'string') return undefined;
            return l + r;
        }

        case 'Identifier': {
            const id = node as acorn.Identifier;
            if (id.name === '__dirname') return fileURLToPath(new URL('.', ctx.sourceUrl));
            if (id.name === '__filename') return fileURLToPath(ctx.sourceUrl);
            return undefined;
        }

        case 'MemberExpression': {
            const me = node as acorn.MemberExpression;
            // import.meta.url
            if (
                me.object.type === 'MetaProperty' &&
                (me.object as acorn.MetaProperty).meta.name === 'import' &&
                (me.object as acorn.MetaProperty).property.name === 'meta' &&
                me.property.type === 'Identifier' &&
                (me.property as acorn.Identifier).name === 'url'
            ) {
                return ctx.sourceUrl;
            }
            // <expr>.href / .pathname
            if (!me.computed && me.property.type === 'Identifier') {
                const obj = evalExpr(me.object, ctx);
                const prop = (me.property as acorn.Identifier).name;
                if (obj instanceof URL) {
                    if (prop === 'href') return obj.href;
                    if (prop === 'pathname') return obj.pathname;
                }
                if (typeof obj === 'string') {
                    if (prop === 'href') return obj; // already a URL string
                    if (prop === 'pathname') {
                        try {
                            return new URL(obj).pathname;
                        } catch {
                            return undefined;
                        }
                    }
                }
            }
            return undefined;
        }

        case 'NewExpression': {
            const ne = node as acorn.NewExpression;
            const calleeName = identifierName(ne.callee);
            if (calleeName === 'URL') {
                if (ne.arguments.length === 0) return undefined;
                const first = evalExpr(ne.arguments[0], ctx);
                if (typeof first !== 'string') return undefined;
                if (ne.arguments.length === 1) {
                    try {
                        return new URL(first);
                    } catch {
                        return undefined;
                    }
                }
                const base = evalExpr(ne.arguments[1], ctx);
                const baseStr = base instanceof URL ? base.href : typeof base === 'string' ? base : undefined;
                if (!baseStr) return undefined;
                try {
                    return new URL(first, baseStr);
                } catch {
                    return undefined;
                }
            }
            return undefined;
        }

        case 'CallExpression': {
            const ce = node as acorn.CallExpression;
            const name = identifierName(ce.callee);

            if (name === 'fileURLToPath') {
                const arg = evalExpr(ce.arguments[0], ctx);
                const url = arg instanceof URL ? arg.href : typeof arg === 'string' ? arg : undefined;
                if (!url) return undefined;
                try {
                    return fileURLToPath(url);
                } catch {
                    return undefined;
                }
            }

            if (name === 'pathToFileURL') {
                const arg = evalExpr(ce.arguments[0], ctx);
                if (typeof arg !== 'string') return undefined;
                try {
                    return pathToFileURL(arg);
                } catch {
                    return undefined;
                }
            }

            if (name === 'join' || name === 'resolve') {
                const args: string[] = [];
                for (const a of ce.arguments) {
                    const v = evalExpr(a, ctx);
                    if (typeof v !== 'string') return undefined;
                    args.push(v);
                }
                return name === 'join' ? join(...args) : resolve(...args);
            }

            if (name === 'dirname' || name === 'basename' || name === 'extname') {
                const v = evalExpr(ce.arguments[0], ctx);
                if (typeof v !== 'string') return undefined;
                if (name === 'dirname') return dirname(v);
                if (name === 'basename') {
                    const ext = ce.arguments.length >= 2 ? evalExpr(ce.arguments[1], ctx) : undefined;
                    return basename(v, typeof ext === 'string' ? ext : undefined);
                }
                if (name === 'extname') return extname(v);
            }

            if (name === 'relative') {
                const a = evalExpr(ce.arguments[0], ctx);
                const b = evalExpr(ce.arguments[1], ctx);
                if (typeof a !== 'string' || typeof b !== 'string') return undefined;
                return relative(a, b);
            }

            return undefined;
        }
    }
    return undefined;
}

/**
 * Evaluate an encoding argument to its canonical string form.
 *   "utf8" / "utf-8"           → "utf8"
 *   { encoding: "utf8" }       → "utf8"
 *   anything else              → undefined (caller leaves the call alone)
 */
function evalEncodingExpr(node: acorn.AnyNode | undefined): string | undefined {
    if (!node) return undefined;
    if (node.type === 'Literal') {
        const v = (node as acorn.Literal).value;
        if (typeof v === 'string') return canonicalEncoding(v);
        return undefined;
    }
    if (node.type === 'ObjectExpression') {
        for (const p of (node as acorn.ObjectExpression).properties) {
            if (p.type !== 'Property' || p.computed) continue;
            const key =
                p.key.type === 'Identifier'
                    ? (p.key as acorn.Identifier).name
                    : p.key.type === 'Literal'
                      ? String((p.key as acorn.Literal).value)
                      : undefined;
            if (key !== 'encoding') continue;
            if (p.value.type === 'Literal' && typeof (p.value as acorn.Literal).value === 'string') {
                return canonicalEncoding((p.value as acorn.Literal).value as string);
            }
            return undefined;
        }
    }
    return undefined;
}

/**
 * Detect `{ withFileTypes: true }` in a readdirSync options argument.
 * Any non-literal or absence returns `false` (safe — we only abort
 * inlining for an unambiguous `true`).
 */
function hasWithFileTypes(node: acorn.AnyNode | undefined): boolean {
    if (!node || node.type !== 'ObjectExpression') return false;
    for (const p of (node as acorn.ObjectExpression).properties) {
        if (p.type !== 'Property' || p.computed) continue;
        const key =
            p.key.type === 'Identifier'
                ? (p.key as acorn.Identifier).name
                : p.key.type === 'Literal'
                  ? String((p.key as acorn.Literal).value)
                  : undefined;
        if (key !== 'withFileTypes') continue;
        if (p.value.type === 'Literal' && (p.value as acorn.Literal).value === true) return true;
        return false;
    }
    return false;
}

function canonicalEncoding(v: string): string | undefined {
    const lc = v.toLowerCase();
    if (lc === 'utf8' || lc === 'utf-8') return 'utf8';
    if (lc === 'ascii') return 'ascii';
    if (lc === 'latin1' || lc === 'binary') return 'latin1';
    return undefined;
}

/**
 * Get the leaf identifier name of a callee. Recognises:
 *   `foo`               → "foo"          (assumed named import)
 *   `path.foo`          → "foo"          (path module namespace/default import)
 *   `fs.foo`            → "foo"          (fs module — caller validates context)
 *
 * For MemberExpression callees, the object identifier is restricted to a
 * known module namespace name (`path`, `fs`, `JSON`). Otherwise `arr.join(',')`
 * (Array.prototype.join) would resolve to `path.join`, and our static
 * evaluator would happily treat a free `dir.join('/')` array call as
 * `path.join('/')` → `'/'` → catastrophic root-directory scan. See PR for
 * the TypeDoc bundling incident this prevents.
 *
 * Returns `undefined` for computed/dynamic callees.
 */
const PATH_NAMESPACE_OBJECTS = new Set(['path', 'fs']);

function identifierName(node: acorn.AnyNode | undefined): string | undefined {
    if (!node) return undefined;
    if (node.type === 'Identifier') return (node as acorn.Identifier).name;
    if (node.type === 'MemberExpression' && !(node as acorn.MemberExpression).computed) {
        const me = node as acorn.MemberExpression;
        if (me.property.type !== 'Identifier') return undefined;
        // The object must be a known namespace identifier — otherwise we
        // misidentify Array.prototype methods (`arr.join`, `arr.includes`)
        // and userland method calls as path/fs functions.
        if (me.object.type !== 'Identifier') return undefined;
        const obj = (me.object as acorn.Identifier).name;
        if (!PATH_NAMESPACE_OBJECTS.has(obj)) return undefined;
        return (me.property as acorn.Identifier).name;
    }
    return undefined;
}

/** Produce a JS source-fragment for a value the inliner produced. */
function jsLiteral(v: unknown): string {
    if (typeof v === 'string') return jsStringLiteral(v);
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v === null) return 'null';
    if (Array.isArray(v)) return '[' + v.map(jsLiteral).join(',') + ']';
    if (typeof v === 'object') {
        const parts: string[] = [];
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            parts.push(`${jsStringLiteral(k)}:${jsLiteral(val)}`);
        }
        return '{' + parts.join(',') + '}';
    }
    return 'undefined';
}

/** JSON.stringify is the safest way to escape arbitrary strings into JS. */
function jsStringLiteral(s: string): string {
    return JSON.stringify(s);
}

// NOTE: `existsSync` needs no wrapper — it never throws by contract (Node
// returns false on any error, and the GJS/Bun/Deno node:fs shims match).
// `statSync` below genuinely throws (ENOENT etc.), hence its guarded helper.

function isDirectorySafe(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}
