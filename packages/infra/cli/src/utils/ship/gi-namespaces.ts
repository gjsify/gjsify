// Which GI namespaces does this bundle actually load?
//
// Read off the EMITTED bundle, because that is the file that gets installed —
// and the emitted form is not one form but two, which is the correction this
// header carries. Under `--app gjs`, `gi://` is a real module protocol, so the
// bundler keeps those specifiers in the output verbatim
// (`rolldown-plugin-gjsify`'s externals plugin) and the artifact carries its own
// dependency list. Under `--app node` there is no such protocol:
// `gjsGiNodePlugin` rewrites every `gi://Ns?version=X` into a shim whose body is
// `require('@gjsify/node-gi/gi').requireGi("Ns", "X")`, so the specifier this
// scanner was written to find is gone from the file by construction.
//
// WHAT THAT COST, and why reading one form is not "mostly right": these
// namespaces are what `depends.ts` maps to `gir1.2-gtk-4.0` and friends
// (ADR 0024 § 6). A `--app node` project therefore derived an EMPTY typelib
// dependency set — the package installed cleanly and died at its first GI call,
// which is the same failure the bare-side-effect-import fix below was written to
// prevent, arriving again through the other build target. Nothing caught it
// because every ship fixture's "node bundle" was hand-written with `gi://`
// imports in it: a shape `gjsify build --app node` cannot emit and node cannot
// run.
//
// PARSED, not pattern-matched, and the first version of this file is why. A
// regex over the bundle text got it wrong in both directions at once:
//
//   * it missed `import "gi://Soup?version=3.0"` — the bare side-effect form,
//     which is exactly what `@gjsify/fetch` puts at the top of every bundle
//     that pulls it. The package would have shipped without libsoup, installed
//     cleanly, and died at the first request.
//   * it matched `gi://…` inside a diagnostic STRING containing the word
//     `from`, and since an unmapped namespace fails the build, that made a
//     correct project unbuildable.
//
// `walkModuleAst` answers both questions in ONE pass, and it is the same acorn
// pass the CLI already uses to compute its own runtime closure — so there is one
// definition of "what does this file import" rather than two.
//
// HARD OR OPTIONAL, since ADR 0086: a `gi://Ns?version=X&optional` import still
// appears in the emitted file, so this scanner still reports its namespace — and
// `depends.ts` has to know it may be absent. The discriminator is the marker
// statement the bundler's own optional shim emits (`GI_OPTIONAL_MARKER`, imported
// from the plugin that writes it rather than restated here). NOT the `import()`
// SHAPE, which was the tempting reading of the same file: an app that writes its own
// `await import('gi://Goa')` without the flag must stay a HARD dependency, and
// classifying it as optional would move a package the host must have out of its
// `Depends:` — the failure this whole chain exists to prevent, reached from the other
// direction.

import { GI_OPTIONAL_MARKER } from '@gjsify/rolldown-plugin-gjsify';

import {
    importedSpecifier,
    staticStringValue,
    walkModuleAst,
    type AstNode,
    type SpecifierNode,
} from '../cli-runtime-closure.js';

/** The module a `--app node` bundle reaches GI through. */
const NODE_GI_MODULE = '@gjsify/node-gi/gi';

/** Namespaces are GI identifiers; anything else is a call this reader misread. */
const NAMESPACE = /^[A-Za-z][A-Za-z\d_]*$/;

/**
 * What a bundle loads, split by whether the host must provide it.
 *
 * `namespaces` is the union — the same answer {@link scanGiNamespaces} has always
 * given — and `optional` is the subset the artifact itself marks optional. A namespace
 * in both is still a hard dependency as far as anything else is concerned: the
 * importer asked for it both ways, and only one of those edges degrades.
 */
export interface GiRequirements {
    /** Every GI namespace the bundle loads, `Ns-Version` where a specifier pins one. */
    namespaces: string[];
    /** The subset carrying the bundler's optional marker — absent is not fatal. */
    optional: string[];
}

/**
 * Extract the GI namespaces a bundle imports, as `Ns-Version` when the
 * specifier pins one and bare `Ns` when it does not.
 */
export function scanGiNamespaces(source: string): string[] {
    return scanGiRequirements(source).namespaces;
}

/** {@link scanGiNamespaces}, plus which of them the artifact marks optional (ADR 0086). */
export function scanGiRequirements(source: string): GiRequirements {
    const found = new Set<string>();
    const optional = new Set<string>();
    // TWO SETS, because the two kinds of binding are not interchangeable and
    // treating them as one over-approximated on a real minified bundle. A
    // namespace object (`import * as gi`) and a required module object are only
    // ever the OBJECT of `.requireGi(…)`: calling a module namespace is a
    // TypeError, so a bare `gi(…)` is never one of ours. Only `requireGi` itself
    // — the named import, or the default export, which IS `requireGi` — is
    // callable on its own.
    //
    // Measured on `gjsify build --app node` (minify is the DEFAULT): a file with
    // `import * as gi from '@gjsify/node-gi/gi'` and a callback parameter emitted
    // as `function render(e,t){return e(t)+e(\`Zzqfoo\`)}` — where the minifier
    // gave the import and the parameter the SAME short name in different scopes.
    // Read as one set, `e(\`Zzqfoo\`)` became the namespace `Zzqfoo`, and
    // `deriveDepends` then refused to package a correct project.
    const callable = new Set<string>();
    const objects = new Set<string>();
    const calls: AstNode[] = [];

    walkModuleAst(source, (node) => {
        const specifier = importedSpecifier(node);
        if (specifier !== null) {
            const key = parseGiSpecifier(specifier);
            if (key !== null) found.add(key);
            if (node.type === 'ImportDeclaration' && specifier === NODE_GI_MODULE) {
                collectNodeGiBindings(node, callable, objects);
            }
            return;
        }
        if (node.type === 'VariableDeclarator' && loadsNodeGiModule(node.init)) {
            const id = node.id as AstNode | undefined;
            // An OBJECT: `const gi = require('@gjsify/node-gi/gi')` is the module,
            // reached as `gi.requireGi(…)` and never called directly.
            if (id?.type === 'Identifier' && typeof id.name === 'string') objects.add(id.name);
            return;
        }
        // Collected rather than resolved in place: a call can precede the
        // `require` that binds its callee (the shim's `load()` is hoisted above
        // nothing, but a minifier is free to reorder declarations), so the
        // binding set has to be complete before any call is judged.
        if (node.type === 'CallExpression') calls.push(node);
    });

    for (const call of calls) {
        const marker = optionalMarkerNamespace(call);
        if (marker !== null) {
            optional.add(marker);
            continue;
        }
        const key = requireGiNamespace(call, callable, objects);
        if (key !== null) found.add(key);
    }
    return { namespaces: [...found].sort(), optional: [...optional].filter((ns) => found.has(ns)).sort() };
}

/**
 * The namespace an optional-marker call names, or `null` when this is not one.
 *
 * The shape is the bundler's: `globalThis[Symbol.for(GI_OPTIONAL_MARKER)]?.("Ns", "X")`,
 * matched on BOTH halves rather than on the whole statement — the minifier rewrites
 * the string literals to backticks and the optional call to a `ChainExpression`
 * around the `CallExpression` this walk still reaches, and a plain call (a host that
 * has a handler the minifier could prove is non-null) reads the same way.
 */
function optionalMarkerNamespace(call: AstNode): string | null {
    const callee = call.callee as AstNode | undefined;
    if (callee?.type !== 'MemberExpression' || callee.computed !== true) return null;
    // `globalThis[Symbol.for(KEY)]` — a computed member whose PROPERTY is the
    // `Symbol.for` call, so the key is an argument of that inner call rather than
    // of the outer one. Verified against acorn's own shape: `optional` chaining
    // wraps the whole thing in a `ChainExpression`, which the walk descends into,
    // so the `CallExpression` reaches this function either way.
    const keyCall = callee.property as AstNode | undefined;
    if (keyCall?.type !== 'CallExpression') return null;
    const keyCallee = keyCall.callee as AstNode | undefined;
    const keyObject = keyCallee?.type === 'MemberExpression' ? (keyCallee.object as AstNode | undefined) : undefined;
    const keyProperty =
        keyCallee?.type === 'MemberExpression' ? (keyCallee.property as AstNode | undefined) : undefined;
    if (keyObject?.type !== 'Identifier' || keyObject.name !== 'Symbol') return null;
    if (keyProperty?.type !== 'Identifier' || keyProperty.name !== 'for') return null;
    const keyArgs = (keyCall.arguments as AstNode[] | undefined) ?? [];
    if (staticStringValue(keyArgs[0] as SpecifierNode | undefined) !== GI_OPTIONAL_MARKER) return null;
    const host = callee.object as AstNode | undefined;
    if (host?.type !== 'Identifier' || host.name !== 'globalThis') return null;
    const args = (call.arguments as AstNode[] | undefined) ?? [];
    const namespace = staticStringValue(args[0] as SpecifierNode | undefined);
    if (namespace === null || !NAMESPACE.test(namespace)) return null;
    const version = staticStringValue(args[1] as SpecifierNode | undefined);
    return version === null || version === '' ? namespace : `${namespace}-${version}`;
}

/** `gi://Gtk?version=4.0` → `Gtk-4.0`; `gi://Gtk` → `Gtk`; anything else → null. */
export function parseGiSpecifier(specifier: string): string | null {
    if (!specifier.startsWith('gi://')) return null;
    const rest = specifier.slice('gi://'.length);
    const [namespace, query] = rest.split('?', 2);
    if (namespace === undefined || !NAMESPACE.test(namespace)) return null;
    if (query === undefined) return namespace;
    const version = /(?:^|&)version=([^&]+)/.exec(query)?.[1];
    return version === undefined ? namespace : `${namespace}-${version}`;
}

/**
 * What an `import … from '@gjsify/node-gi/gi'` binds, split by what it can BE.
 *
 * All three spellings appear in real code and the default export IS `requireGi`
 * (`packages/node-gi/node-gi/gi.d.ts`), so the named import (under any local
 * name — `import { requireGi as gi }` renames it) and the default import are
 * CALLABLE. A namespace import is not: calling a module namespace object throws,
 * so it can only ever be the object of `.requireGi(…)`, and putting it in the
 * callable set is what let a minified callback parameter of the same name be
 * read as a `requireGi` call.
 */
function collectNodeGiBindings(node: AstNode, callable: Set<string>, objects: Set<string>): void {
    const specifiers = (node.specifiers as AstNode[] | undefined) ?? [];
    for (const specifier of specifiers) {
        const local = specifier.local as AstNode | undefined;
        if (local?.type !== 'Identifier' || typeof local.name !== 'string') continue;
        const imported = specifier.imported as AstNode | undefined;
        if (specifier.type === 'ImportNamespaceSpecifier') objects.add(local.name);
        else if (specifier.type === 'ImportDefaultSpecifier') callable.add(local.name);
        else if (imported?.type === 'Identifier' && imported.name === 'requireGi') callable.add(local.name);
    }
}

/**
 * A call that LOADS `@gjsify/node-gi/gi` — recognised by its argument, never by
 * the name of the callee.
 *
 * THE CALLEE NAME DOES NOT SURVIVE BUNDLING, and reading it is how the first cut
 * of this function passed its own tests while answering `[]` for every real
 * artifact. Measured on `gjsify build --app node` output for a two-import app,
 * which is the exact input this module exists to read:
 *
 *     unminified   const require$1 = createRequire(import.meta.url);
 *                  … require$1("@gjsify/node-gi/gi").requireGi("Gtk", "4.0")
 *     minified     const n = e(import.meta.url);
 *                  … n(`@gjsify/node-gi/gi`).requireGi(`Gtk`, `4.0`)
 *
 * Two shims in one bundle means two `require` bindings, so the second is renamed
 * even without `--minify` (which is the DEFAULT). A reader keyed on the
 * identifier `require` therefore loses one namespace unminified and both
 * minified — silently, since an empty namespace list is a legal answer.
 *
 * The module STRING is what survives every rename, and it is a precise
 * discriminator: a call taking `'@gjsify/node-gi/gi'` as its first argument is a
 * load of that module under any name a bundler gives the loader.
 */
function loadsNodeGiModule(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const call = node as AstNode;
    if (call.type !== 'CallExpression') return false;
    const args = (call.arguments as AstNode[] | undefined) ?? [];
    return staticStringValue(args[0] as SpecifierNode | undefined) === NODE_GI_MODULE;
}

/**
 * The namespace a `requireGi(…)` call names, or `null` when this is not one.
 *
 * BINDING-TRACED rather than name-matched, and the asymmetry is deliberate: a
 * bare `.requireGi(…)` on any object would over-approximate, and
 * over-approximating is NOT the harmless direction here — an unmapped namespace
 * fails the build, so a foreign method sharing the name would make a correct
 * project unpackageable. Every accepted shape traces back to an import or
 * require of `@gjsify/node-gi/gi` in this same file, which is what a bundle
 * always has: the shim carries its own `require`, and a hand-written node-gi app
 * carries its own import.
 *
 * Shadowing is the one gap left, and the split above is what makes it small.
 * This reader has no scope analysis, so a local binding that reuses the name of
 * the CALLABLE import — `requireGi` itself, or the default import — and is called
 * with a GI-shaped string literal would still be read as one. A minifier can
 * manufacture exactly that collision, which is why the two shapes it produces
 * most (the namespace object and the required module object) are the two that no
 * longer count as callees.
 */
function requireGiNamespace(call: AstNode, callable: ReadonlySet<string>, objects: ReadonlySet<string>): string | null {
    const callee = call.callee as AstNode | undefined;
    let reached = false;
    if (callee?.type === 'Identifier') {
        reached = typeof callee.name === 'string' && callable.has(callee.name);
    } else if (callee?.type === 'MemberExpression' && callee.computed !== true) {
        const property = callee.property as AstNode | undefined;
        if (property?.type !== 'Identifier' || property.name !== 'requireGi') return null;
        const object = callee.object as AstNode | undefined;
        reached =
            loadsNodeGiModule(object) ||
            (object?.type === 'Identifier' && typeof object.name === 'string' && objects.has(object.name));
    }
    if (!reached) return null;

    const args = (call.arguments as AstNode[] | undefined) ?? [];
    const namespace = staticStringValue(args[0] as SpecifierNode | undefined);
    if (namespace === null || !NAMESPACE.test(namespace)) return null;
    const version = staticStringValue(args[1] as SpecifierNode | undefined);
    return version === null ? namespace : `${namespace}-${version}`;
}
