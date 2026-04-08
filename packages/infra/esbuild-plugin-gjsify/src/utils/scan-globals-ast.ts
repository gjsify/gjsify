// AST-based global-reference scanner — the default scanner used by the
// `--auto-globals` feature. Uses acorn + acorn-walk to find identifier
// references that are NOT shadowed by local declarations, which
// eliminates false positives like `const fetch = 42`.
//
// On any failure (file I/O, TypeScript strip, or AST parse), the function
// THROWS so the caller in gjs.ts can fall back to the regex scanner in
// scan-globals.ts. No items are added to the accumulator before the walk
// phase runs, so a thrown error cannot leave partial state behind.

import { readFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import { Parser } from 'acorn';
import { simple as walkSimple, ancestor as walkAncestor } from 'acorn-walk';

import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';

const GLOBALS_MAP: Record<string, string> = GJS_GLOBALS_MAP;

/**
 * Scan a single file's source for known global identifier references using
 * a full JavaScript parser. Type-annotated TypeScript is stripped via
 * esbuild.transform before parsing.
 *
 * Shadowed identifiers (local `const fetch = ...`, function parameters,
 * import bindings) are ignored.
 */
export async function scanFileForGlobalsAst(
    filePath: string,
    accumulator: Set<string>,
): Promise<void> {
    // Any error here (file I/O, TS strip, parse) propagates to the caller
    // in gjs.ts, which falls back to the regex scanner. No mutations to
    // the accumulator happen before the walk phase, so a throw cannot
    // leave partial state behind.
    const rawCode = await readFile(filePath, 'utf-8');

    // Strip TypeScript types via esbuild's transform so acorn can parse it.
    const transformed = await esbuild.transform(rawCode, {
        loader: /\.tsx?$/.test(filePath) ? 'ts' : 'js',
        format: 'esm',
        target: 'esnext',
    });
    const code = transformed.code;

    const ast = Parser.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
        allowHashBang: true,
    });

    // Collect module-level bindings that shadow globals (imports, top-level
    // const/let/var, function declarations, class declarations). Scope-aware
    // walking of nested functions is handled by the ancestor walker below
    // via the `state` parameter.
    const moduleBindings = new Set<string>();

    walkSimple(ast, {
        ImportSpecifier(node: any) {
            if (node.local?.type === 'Identifier') moduleBindings.add(node.local.name);
        },
        ImportDefaultSpecifier(node: any) {
            if (node.local?.type === 'Identifier') moduleBindings.add(node.local.name);
        },
        ImportNamespaceSpecifier(node: any) {
            if (node.local?.type === 'Identifier') moduleBindings.add(node.local.name);
        },
        VariableDeclarator(node: any) {
            collectPatternBindings(node.id, moduleBindings);
        },
        FunctionDeclaration(node: any) {
            if (node.id?.type === 'Identifier') moduleBindings.add(node.id.name);
        },
        ClassDeclaration(node: any) {
            if (node.id?.type === 'Identifier') moduleBindings.add(node.id.name);
        },
    });

    // Walk identifier references. For each identifier, check whether it is
    // bound by any enclosing function/block scope (by inspecting ancestors)
    // or by the module-level bindings set. If not, and the identifier is in
    // the globals map, record its register path.
    walkAncestor(ast, {
        Identifier(node: any, _state: unknown, ancestors: any[]) {
            const name = node.name;
            if (!GLOBALS_MAP[name]) return;

            // Skip non-reference positions (declarations, property keys, etc.)
            if (!isReferencePosition(node, ancestors)) return;

            // Skip if shadowed by a local binding in any ancestor function/block
            if (isShadowed(name, ancestors)) return;
            if (moduleBindings.has(name)) return;

            accumulator.add(GLOBALS_MAP[name]);
        },
    });
}

/**
 * Walk a destructuring pattern and add every bound identifier to the set.
 */
function collectPatternBindings(pattern: any, out: Set<string>): void {
    if (!pattern) return;
    switch (pattern.type) {
        case 'Identifier':
            out.add(pattern.name);
            return;
        case 'ArrayPattern':
            for (const el of pattern.elements) {
                if (el) collectPatternBindings(el, out);
            }
            return;
        case 'ObjectPattern':
            for (const prop of pattern.properties) {
                if (prop.type === 'Property') {
                    collectPatternBindings(prop.value, out);
                } else if (prop.type === 'RestElement') {
                    collectPatternBindings(prop.argument, out);
                }
            }
            return;
        case 'RestElement':
            collectPatternBindings(pattern.argument, out);
            return;
        case 'AssignmentPattern':
            collectPatternBindings(pattern.left, out);
            return;
    }
}

/**
 * Check whether the identifier node is in a position that references a
 * binding (as opposed to declaring one or being a property name).
 */
function isReferencePosition(node: any, ancestors: any[]): boolean {
    if (ancestors.length < 2) return true;
    const parent = ancestors[ancestors.length - 2];
    if (!parent) return true;

    // Member access: `foo.Buffer` — only `foo` is a reference, not `Buffer`.
    if (parent.type === 'MemberExpression' && !parent.computed && parent.property === node) {
        return false;
    }
    // Property key in object literal: `{ fetch: x }` — the key is not a reference.
    if (parent.type === 'Property' && !parent.computed && parent.key === node) {
        return false;
    }
    // Method definition name, class member, etc.
    if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition')
        && !parent.computed && parent.key === node) {
        return false;
    }
    // Declaration sites: variable declarators, function/class names, parameters
    if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
    if (parent.type === 'FunctionDeclaration' && parent.id === node) return false;
    if (parent.type === 'FunctionExpression' && parent.id === node) return false;
    if (parent.type === 'ClassDeclaration' && parent.id === node) return false;
    if (parent.type === 'ClassExpression' && parent.id === node) return false;
    // Import specifier locals are handled elsewhere (they are declarations).
    if (parent.type === 'ImportSpecifier' && parent.local === node) return false;
    if (parent.type === 'ImportDefaultSpecifier' && parent.local === node) return false;
    if (parent.type === 'ImportNamespaceSpecifier' && parent.local === node) return false;
    // Labels
    if (parent.type === 'LabeledStatement' && parent.label === node) return false;
    if (parent.type === 'BreakStatement' && parent.label === node) return false;
    if (parent.type === 'ContinueStatement' && parent.label === node) return false;

    return true;
}

/**
 * Check whether the identifier is shadowed by a binding in any enclosing
 * function or block scope. Walks ancestors in reverse and inspects variable
 * declarators, function parameters and catch clause params.
 */
function isShadowed(name: string, ancestors: any[]): boolean {
    // Walk from innermost to outermost, skipping the identifier itself.
    for (let i = ancestors.length - 2; i >= 0; i--) {
        const anc = ancestors[i];
        if (!anc) continue;

        // Function declaration / expression / arrow: check params.
        if (anc.type === 'FunctionDeclaration'
            || anc.type === 'FunctionExpression'
            || anc.type === 'ArrowFunctionExpression') {
            for (const p of anc.params) {
                const seen = new Set<string>();
                collectPatternBindings(p, seen);
                if (seen.has(name)) return true;
            }
        }

        // Catch clause: `catch (Buffer) { ... }`
        if (anc.type === 'CatchClause' && anc.param) {
            const seen = new Set<string>();
            collectPatternBindings(anc.param, seen);
            if (seen.has(name)) return true;
        }

        // Block scope: check all VariableDeclarations in the block body that
        // appear BEFORE the identifier position (hoisted var/let/const all
        // count for our purposes since we only need a coarse "is this name
        // defined locally" check).
        if (anc.type === 'BlockStatement' || anc.type === 'Program') {
            const body: any[] = anc.body ?? [];
            for (const stmt of body) {
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations) {
                        const seen = new Set<string>();
                        collectPatternBindings(decl.id, seen);
                        if (seen.has(name)) return true;
                    }
                }
                if (stmt.type === 'FunctionDeclaration' && stmt.id?.name === name) return true;
                if (stmt.type === 'ClassDeclaration' && stmt.id?.name === name) return true;
            }
        }
    }
    return false;
}
