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
 * Extract the GI namespaces a bundle imports, as `Ns-Version` when the
 * specifier pins one and bare `Ns` when it does not.
 */
export function scanGiNamespaces(source: string): string[] {
    const found = new Set<string>();
    const bindings = new Set<string>();
    const calls: AstNode[] = [];

    walkModuleAst(source, (node) => {
        const specifier = importedSpecifier(node);
        if (specifier !== null) {
            const key = parseGiSpecifier(specifier);
            if (key !== null) found.add(key);
            if (node.type === 'ImportDeclaration' && specifier === NODE_GI_MODULE) {
                collectNodeGiBindings(node, bindings);
            }
            return;
        }
        if (node.type === 'VariableDeclarator' && loadsNodeGiModule(node.init)) {
            const id = node.id as AstNode | undefined;
            if (id?.type === 'Identifier' && typeof id.name === 'string') bindings.add(id.name);
            return;
        }
        // Collected rather than resolved in place: a call can precede the
        // `require` that binds its callee (the shim's `load()` is hoisted above
        // nothing, but a minifier is free to reorder declarations), so the
        // binding set has to be complete before any call is judged.
        if (node.type === 'CallExpression') calls.push(node);
    });

    for (const call of calls) {
        const key = requireGiNamespace(call, bindings);
        if (key !== null) found.add(key);
    }
    return [...found].sort();
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
 * The local names an `import … from '@gjsify/node-gi/gi'` binds to `requireGi`.
 *
 * All three spellings, because all three appear in real code and the default
 * export IS `requireGi` (`packages/node-gi/node-gi/gi.d.ts`): the named import
 * (under any local name, since `import { requireGi as gi }` renames it), the
 * default import, and the namespace object — whose member access
 * {@link requireGiNamespace} handles, which is why the namespace binding is
 * collected here too.
 */
function collectNodeGiBindings(node: AstNode, out: Set<string>): void {
    const specifiers = (node.specifiers as AstNode[] | undefined) ?? [];
    for (const specifier of specifiers) {
        const local = specifier.local as AstNode | undefined;
        if (local?.type !== 'Identifier' || typeof local.name !== 'string') continue;
        const imported = specifier.imported as AstNode | undefined;
        if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
            out.add(local.name);
        } else if (imported?.type === 'Identifier' && imported.name === 'requireGi') {
            out.add(local.name);
        }
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
 * Shadowing is the one gap left, and it is bounded rather than open: a local
 * function named after the imported one would have to be called with a
 * GI-shaped string literal to be misread at all.
 */
function requireGiNamespace(call: AstNode, bindings: ReadonlySet<string>): string | null {
    const callee = call.callee as AstNode | undefined;
    let reached = false;
    if (callee?.type === 'Identifier') {
        reached = typeof callee.name === 'string' && bindings.has(callee.name);
    } else if (callee?.type === 'MemberExpression' && callee.computed !== true) {
        const property = callee.property as AstNode | undefined;
        if (property?.type !== 'Identifier' || property.name !== 'requireGi') return null;
        const object = callee.object as AstNode | undefined;
        reached =
            loadsNodeGiModule(object) ||
            (object?.type === 'Identifier' && typeof object.name === 'string' && bindings.has(object.name));
    }
    if (!reached) return null;

    const args = (call.arguments as AstNode[] | undefined) ?? [];
    const namespace = staticStringValue(args[0] as SpecifierNode | undefined);
    if (namespace === null || !NAMESPACE.test(namespace)) return null;
    const version = staticStringValue(args[1] as SpecifierNode | undefined);
    return version === null ? namespace : `${namespace}-${version}`;
}
