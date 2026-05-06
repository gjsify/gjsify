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
import * as walk from 'acorn-walk';
import { dirname, join, resolve, basename, relative, extname } from 'node:path';
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
export function inlineStaticReads(
    src: string,
    sourceFilePath: string,
): { contents: string; inlined: number } {
    if (
        !src.includes('readFileSync') &&
        !src.includes('readdirSync') &&
        !src.includes('existsSync')
    ) {
        return { contents: src, inlined: 0 };
    }

    let ast: acorn.Program;
    try {
        ast = acorn.parse(src, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            allowAwaitOutsideFunction: true,
            allowReturnOutsideFunction: true,
            allowImportExportEverywhere: true,
        });
    } catch {
        // Source isn't valid JS (CJS source with shebangs, mixed module
        // syntax, ...). Skip; the rest of the rewriter still runs.
        return { contents: src, inlined: 0 };
    }

    const ctx: InlineContext = {
        sourceUrl: pathToFileURL(sourceFilePath).href,
    };
    const edits: Edit[] = [];

    walk.simple(ast, {
        CallExpression(node: acorn.CallExpression) {
            const edit = tryInlineCall(node, ctx, src);
            if (edit) edits.push(edit);
        },
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
function tryInlineCall(
    node: acorn.CallExpression,
    ctx: InlineContext,
    src: string,
): Edit | undefined {
    const callee = node.callee;

    // `JSON.parse(readFileSync(<path>, "utf8"))` — collapse the whole
    // composition. Recognising it specifically lets us emit a parsed-JSON
    // object literal instead of a `JSON.parse('…')` string-then-parse pair,
    // which esbuild can dead-code-eliminate against.
    if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' && callee.object.name === 'JSON' &&
        callee.property.type === 'Identifier' && callee.property.name === 'parse' &&
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
        const path = evalPathExpr(node.arguments[0], ctx);
        if (path && existsSyncSafe(path) && isDirectorySafe(path)) {
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
                replacement: existsSyncSafe(path) ? 'true' : 'false',
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
    if (!existsSyncSafe(path) || isDirectorySafe(path)) return undefined;

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
    if (v.startsWith('/')) return v;
    return undefined;
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
                        try { return new URL(obj).pathname; } catch { return undefined; }
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
                    try { return new URL(first); } catch { return undefined; }
                }
                const base = evalExpr(ne.arguments[1], ctx);
                const baseStr = base instanceof URL ? base.href : (typeof base === 'string' ? base : undefined);
                if (!baseStr) return undefined;
                try { return new URL(first, baseStr); } catch { return undefined; }
            }
            return undefined;
        }

        case 'CallExpression': {
            const ce = node as acorn.CallExpression;
            const name = identifierName(ce.callee);

            if (name === 'fileURLToPath') {
                const arg = evalExpr(ce.arguments[0], ctx);
                const url = arg instanceof URL ? arg.href : (typeof arg === 'string' ? arg : undefined);
                if (!url) return undefined;
                try { return fileURLToPath(url); } catch { return undefined; }
            }

            if (name === 'pathToFileURL') {
                const arg = evalExpr(ce.arguments[0], ctx);
                if (typeof arg !== 'string') return undefined;
                try { return pathToFileURL(arg); } catch { return undefined; }
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
            const key = p.key.type === 'Identifier'
                ? (p.key as acorn.Identifier).name
                : p.key.type === 'Literal' ? String((p.key as acorn.Literal).value) : undefined;
            if (key !== 'encoding') continue;
            if (p.value.type === 'Literal' && typeof (p.value as acorn.Literal).value === 'string') {
                return canonicalEncoding((p.value as acorn.Literal).value as string);
            }
            return undefined;
        }
    }
    return undefined;
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
 *   `foo`               → "foo"
 *   `path.foo`          → "foo"
 *   `node:path.foo`     → "foo" (rare)
 *   `fs.foo` / `fs.promises.foo` → "foo"
 * Returns `undefined` for computed/dynamic callees.
 */
function identifierName(node: acorn.AnyNode | undefined): string | undefined {
    if (!node) return undefined;
    if (node.type === 'Identifier') return (node as acorn.Identifier).name;
    if (node.type === 'MemberExpression' && !(node as acorn.MemberExpression).computed) {
        const me = node as acorn.MemberExpression;
        if (me.property.type === 'Identifier') return (me.property as acorn.Identifier).name;
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

function existsSyncSafe(path: string): boolean {
    try { return existsSync(path); } catch { return false; }
}

function isDirectorySafe(path: string): boolean {
    try { return statSync(path).isDirectory(); } catch { return false; }
}
