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
 * Method markers — `<host>.<method>(…)` patterns that imply a global
 * identifier should be injected even though the identifier itself never
 * appears in the bundle.
 *
 * Example: a project that calls `navigator.getGamepads()` doesn't reference
 * any of the gamepad-related identifiers in the globals map, but it still
 * needs `@gjsify/gamepad/register` to patch `navigator` with the method.
 * This marker maps `navigator.getGamepads` → inject the `GamepadEvent`
 * register path (which is the gamepad package's register entry).
 *
 * Keyed by `host.method` (lowercase host, exact method name). Values are
 * KNOWN_GLOBALS identifiers — the detector adds them as free globals if
 * the corresponding member expression is found in the bundle.
 */
const METHOD_MARKERS: Record<string, string> = {
    // Gamepad API — navigator.getGamepads is patched on by @gjsify/gamepad/register
    'navigator.getGamepads': 'GamepadEvent',
    // WebRTC — navigator.mediaDevices is patched on by @gjsify/webrtc/register/media-devices
    'navigator.mediaDevices': 'MediaDevices',
    // WebAssembly Promise APIs — the runtime stubs throw at first call, so
    // any reference to these methods needs the `@gjsify/webassembly` polyfill.
    // The register entry replaces the stubs with wrappers around the working
    // synchronous `new WebAssembly.{Module,Instance}` constructors.
    'WebAssembly.compile':              'WebAssembly',
    'WebAssembly.compileStreaming':     'WebAssembly',
    'WebAssembly.instantiate':          'WebAssembly',
    'WebAssembly.instantiateStreaming': 'WebAssembly',
    'WebAssembly.validate':             'WebAssembly',
    // Note: URL.createObjectURL / URL.revokeObjectURL don't need markers —
    // they are first-class static methods on @gjsify/url's URL class, so the
    // free `URL` identifier (detected directly, maps to
    // @gjsify/node-globals/register/url in GJS_GLOBALS_MAP) already pulls in
    // the correct register module.
};

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
    // Also detects MemberExpressions like `globalThis.X` / `global.X` /
    // `window.X` / `self.X` where X is a known global. esbuild's `define`
    // config replaces `global`/`window` with `globalThis`, but we accept
    // all four host-object names for safety (esbuild also never renames
    // these because they are language keywords / pre-defined globals).
    const freeGlobals = new Set<string>();
    const HOST_OBJECTS = new Set(['globalThis', 'global', 'window', 'self', 'globalObject']);

    walk.ancestor(ast, {
        MemberExpression(node: acorn.MemberExpression) {
            // Only dot-access — skip computed (bracket) access since the
            // property is then a dynamic Expression, not a known name.
            if (node.computed) return;
            if (node.object.type !== 'Identifier') return;
            if (node.property.type !== 'Identifier') return;

            const objName = (node.object as acorn.Identifier).name;
            const propName = (node.property as acorn.Identifier).name;

            // Pattern A: globalThis.X / global.X / window.X / self.X
            // The property is a known global identifier itself.
            if (HOST_OBJECTS.has(objName)) {
                if (KNOWN_GLOBALS.has(propName)) {
                    freeGlobals.add(propName);
                }
                return;
            }

            // Pattern B: known-instance method markers like
            // `navigator.getGamepads` → marker map forwards to a global
            // identifier that triggers the right register path even though
            // the identifier itself never appears in the bundle.
            const markerKey = `${objName}.${propName}`;
            const markerTarget = METHOD_MARKERS[markerKey];
            if (markerTarget && KNOWN_GLOBALS.has(markerTarget)) {
                freeGlobals.add(markerTarget);
            }
        },
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
