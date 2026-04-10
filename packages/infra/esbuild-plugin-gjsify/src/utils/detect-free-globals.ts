// Detect free (unbound) global identifiers in bundled JS output.
//
// Used by the `--globals auto` two-pass build: the first esbuild pass
// produces a minified bundle without globals injection, this module
// parses it with acorn and finds references to known GJS globals that
// are not locally declared. The result feeds the second pass's inject
// stub so only actually-needed globals are registered.

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';

const KNOWN_GLOBALS = new Set(Object.keys(GJS_GLOBALS_MAP as Record<string, string>));

/**
 * Extract all bound names from a binding pattern
 * (Identifier, ObjectPattern, ArrayPattern, AssignmentPattern, RestElement).
 */
function extractBindingNames(node: acorn.AnyNode): string[] {
    if (!node) return [];
    switch (node.type) {
        case 'Identifier':
            return [(node as acorn.Identifier).name];
        case 'ObjectPattern':
            return (node as acorn.ObjectPattern).properties.flatMap((p) =>
                p.type === 'RestElement'
                    ? extractBindingNames(p.argument)
                    : extractBindingNames((p as acorn.Property).value),
            );
        case 'ArrayPattern':
            return (node as acorn.ArrayPattern).elements.flatMap((e) =>
                e
                    ? e.type === 'RestElement'
                        ? extractBindingNames(e.argument)
                        : extractBindingNames(e)
                    : [],
            );
        case 'AssignmentPattern':
            return extractBindingNames((node as acorn.AssignmentPattern).left);
        case 'RestElement':
            return extractBindingNames((node as acorn.RestElement).argument);
        default:
            return [];
    }
}

/**
 * Parse bundled JS code and return the set of free (unbound) identifiers
 * that match known GJS globals from `GJS_GLOBALS_MAP`.
 *
 * "Free" means the identifier is referenced but never declared in the
 * module (var/let/const/function/class/import/param/catch).
 *
 * After esbuild bundling + minification, local variables that shadow
 * globals are renamed to short names, so any surviving known-global name
 * in the output is almost certainly a true global reference. The
 * declared-names check is a safety net for edge cases where esbuild
 * keeps the original name.
 *
 * `typeof X` references ARE included — if code guards with
 * `typeof fetch !== 'undefined'`, it intends to use fetch when available
 * and we can provide it.
 */
export function detectFreeGlobals(code: string): Set<string> {
    const ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
    });

    // --- Pass 1: collect all declared names across the entire module ---
    const declaredNames = new Set<string>();

    walk.simple(ast, {
        VariableDeclarator(node: acorn.VariableDeclarator) {
            for (const name of extractBindingNames(node.id)) {
                declaredNames.add(name);
            }
        },
        FunctionDeclaration(node: acorn.FunctionDeclaration) {
            if (node.id) declaredNames.add(node.id.name);
            for (const param of node.params) {
                for (const name of extractBindingNames(param)) {
                    declaredNames.add(name);
                }
            }
        },
        FunctionExpression(node: acorn.FunctionExpression) {
            if (node.id) declaredNames.add(node.id.name);
            for (const param of node.params) {
                for (const name of extractBindingNames(param)) {
                    declaredNames.add(name);
                }
            }
        },
        ArrowFunctionExpression(node: acorn.ArrowFunctionExpression) {
            for (const param of node.params) {
                for (const name of extractBindingNames(param)) {
                    declaredNames.add(name);
                }
            }
        },
        ClassDeclaration(node: acorn.ClassDeclaration) {
            if (node.id) declaredNames.add(node.id.name);
        },
        ImportSpecifier(node: acorn.ImportSpecifier) {
            declaredNames.add(node.local.name);
        },
        ImportDefaultSpecifier(node: acorn.ImportDefaultSpecifier) {
            declaredNames.add(node.local.name);
        },
        ImportNamespaceSpecifier(node: acorn.ImportNamespaceSpecifier) {
            declaredNames.add(node.local.name);
        },
        CatchClause(node: acorn.CatchClause) {
            if (node.param) {
                for (const name of extractBindingNames(node.param)) {
                    declaredNames.add(name);
                }
            }
        },
    });

    // --- Pass 2: find Identifier nodes in reference position ---
    const freeGlobals = new Set<string>();

    walk.ancestor(ast, {
        Identifier(node: acorn.Identifier, ancestors: acorn.AnyNode[]) {
            const name = node.name;

            // Quick filter: only check known globals
            if (!KNOWN_GLOBALS.has(name)) return;

            // Skip if locally declared
            if (declaredNames.has(name)) return;

            // Determine if this Identifier is in a reference position
            // by checking the parent node.
            const parent = ancestors[ancestors.length - 2];
            if (!parent) {
                freeGlobals.add(name);
                return;
            }

            switch (parent.type) {
                // obj.prop — skip if this is the non-computed property
                case 'MemberExpression': {
                    const mem = parent as acorn.MemberExpression;
                    if (mem.property === (node as acorn.AnyNode) && !mem.computed) return;
                    break;
                }
                // { key: value } — skip if this is the non-computed key
                case 'Property': {
                    const prop = parent as acorn.Property;
                    if (prop.key === (node as acorn.AnyNode) && !prop.computed) return;
                    break;
                }
                // Method/property definitions in classes
                case 'MethodDefinition':
                case 'PropertyDefinition': {
                    const def = parent as acorn.MethodDefinition | acorn.PropertyDefinition;
                    if (def.key === (node as acorn.AnyNode) && !def.computed) return;
                    break;
                }
                // label: — skip
                case 'LabeledStatement': {
                    const labeled = parent as acorn.LabeledStatement;
                    if (labeled.label === (node as acorn.AnyNode)) return;
                    break;
                }
                // export { X as Y } — skip the exported name
                case 'ExportSpecifier': {
                    const spec = parent as acorn.ExportSpecifier;
                    if (spec.exported === (node as acorn.AnyNode)) return;
                    break;
                }
                // Declaration ids (function name, class name, variable id)
                // are already in declaredNames, but guard anyway
                case 'FunctionDeclaration':
                case 'FunctionExpression':
                case 'ClassDeclaration':
                case 'ClassExpression': {
                    const decl = parent as
                        | acorn.FunctionDeclaration
                        | acorn.FunctionExpression
                        | acorn.ClassDeclaration
                        | acorn.ClassExpression;
                    if (decl.id === (node as acorn.AnyNode)) return;
                    break;
                }
                case 'VariableDeclarator': {
                    const vd = parent as acorn.VariableDeclarator;
                    if (vd.id === (node as acorn.AnyNode)) return;
                    break;
                }
                // import { X } / import X — already in declaredNames
                case 'ImportSpecifier':
                case 'ImportDefaultSpecifier':
                case 'ImportNamespaceSpecifier':
                    return;
            }

            freeGlobals.add(name);
        },
    });

    return freeGlobals;
}
