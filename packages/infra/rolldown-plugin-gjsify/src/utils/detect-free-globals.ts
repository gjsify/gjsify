// Detect free (unbound) global identifiers in bundled JS output.
//
// Drives the `--globals auto` iterative build (`auto-globals.ts`): each analysis pass
// bundles UNMINIFIED and without injection, this module parses that output with acorn
// and finds references to known GJS globals that are not locally declared, and the
// result feeds the next pass's inject stub so only actually-needed globals are
// registered. Minification is forbidden in those passes because it aliases
// `globalThis` to a short variable and defeats the MemberExpression patterns below.

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';
import { classifyJsxParseFailure, formatSurvivingJsx } from './jsx-survival.js';

const KNOWN_GLOBALS = new Set(Object.keys(GJS_GLOBALS_MAP as Record<string, string>));

/**
 * `<host>.<method>` patterns that must inject a global even though the identifier
 * itself never appears in the bundle: a project calling `navigator.getGamepads()`
 * references no gamepad identifier, yet still needs `@gjsify/gamepad/register` to
 * patch the method onto `navigator`.
 *
 * Keyed `host.method` (exact names); values are KNOWN_GLOBALS identifiers the detector
 * adds as free globals when the member expression is found.
 */
const METHOD_MARKERS: Record<string, string> = {
    // Patched on by @gjsify/gamepad/register
    'navigator.getGamepads': 'GamepadEvent',
    // Patched on by @gjsify/webrtc/register/media-devices
    'navigator.mediaDevices': 'MediaDevices',
    // The runtime stubs throw at first call, so any reference needs the
    // `@gjsify/webassembly` polyfill, whose register replaces them with wrappers around
    // the working synchronous `new WebAssembly.{Module,Instance}` constructors.
    'WebAssembly.compile': 'WebAssembly',
    'WebAssembly.compileStreaming': 'WebAssembly',
    'WebAssembly.instantiate': 'WebAssembly',
    'WebAssembly.instantiateStreaming': 'WebAssembly',
    'WebAssembly.validate': 'WebAssembly',
    // `URL.createObjectURL`/`revokeObjectURL` need no marker: they are first-class
    // statics on @gjsify/url's URL class, so the directly-detected free `URL` already
    // pulls the right register module.
};

/**
 * wasm-bindgen function-name patterns that must inject a global. wasm-bindgen emits its
 * host-API import bindings as top-level `__wbg_<jsName>_<hash>` functions whose body is
 * `getObject(arg0).<jsName>` — a runtime heap dereference the MemberExpression visitor
 * cannot follow (`node.object` is a CallExpression), so the underlying property access
 * is invisible to the static scan.
 *
 * Matching the FUNCTION NAME instead is high precision (`__wbg_` is
 * wasm-bindgen-reserved) and high recall (the names are stable across versions). Add an
 * entry whenever a wasm-bindgen-built package needs a global the scan misses. Keyed by
 * `<jsName>`; value is the gjsify global to inject.
 */
const WASM_BINDGEN_MARKERS: Record<string, string> = {
    // wasm-bindgen's canonical crypto-import binding chain — ed25519-dalek, ring, rand
    // and most Rust crates touching randomness or hashing. Loro drives it: its CRDT ops
    // need crypto.getRandomValues for peer ids and ChangeID nonces.
    crypto: 'crypto',
    getRandomValues: 'crypto',
    // Legacy IE fallback wasm-bindgen probes when `crypto` is absent. Irrelevant to GJS
    // (we ship a real `crypto`); mapped so the marker set is self-documenting.
    msCrypto: 'crypto',
};

/**
 * The `<jsName>` part of `__wbg_<jsName>_<hash>`, or null. Hashes are 8–16 hex chars in
 * practice; any alphanumeric trailer is accepted so the pattern survives format tweaks.
 */
const WBG_NAME_RE = /^__wbg_([A-Za-z][A-Za-z0-9]*)_[A-Za-z0-9]+$/;
function wbgJsNameFor(fnName: string): string | null {
    const match = fnName.match(WBG_NAME_RE);
    return match?.[1] ?? null;
}

/** Every name bound by a binding pattern. */
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
                e ? (e.type === 'RestElement' ? extractBindingNames(e.argument) : extractBindingNames(e)) : [],
            );
        case 'AssignmentPattern':
            return extractBindingNames((node as acorn.AssignmentPattern).left);
        case 'RestElement':
            return extractBindingNames((node as acorn.RestElement).argument);
        default:
            return [];
    }
}

interface ScanOptions {
    /** Identifier set to treat as known globals (the only names ever flagged). */
    knownGlobals: ReadonlySet<string>;
    /** `<host>.<method>` markers → injected identifier. Omitted = none. */
    methodMarkers?: Record<string, string>;
    /** wasm-bindgen `<jsName>` markers → injected identifier. Omitted = none. */
    wasmMarkers?: Record<string, string>;
    /**
     * Ignore `host.X` member expressions entirely — only BARE free identifiers trigger.
     *
     * Default false keeps Pattern A firing, the long-standing GJS `--globals auto`
     * behaviour (packages legitimately read `globalThis.Buffer`). The `--app node`
     * GJS-ambient detector turns it ON: genuine GJS source uses the bare forms
     * (`print(...)`, `imports.gi.Gtk`), whereas `globalThis.imports`/`globalThis.print`
     * is the cross-platform ISOMORPHIC-GUARD shape a package uses to branch on GJS.
     * Injecting `@gjsify/node-gi/globals` for that breaks plain-Node loadability of such
     * a package — the bare external import is unresolvable without node-gi and the shim
     * eagerly loads the native addon (the #641/#644 gated-load regression).
     */
    ignoreHostMembers?: boolean;
}

/**
 * Parse one analysis chunk, and say what a JSX failure IS.
 *
 * This parse is the first thing a `--globals auto` build does with bundled output, so a
 * `jsx: "preserve"` project with no framework compiler dies HERE — and acorn's own
 * message is `Unexpected token (3:11)`, which names neither JSX, nor the file, nor a
 * setting. Every other parse failure is re-thrown untouched: acorn trailing
 * SpiderMonkey on new syntax is acorn's problem, not the project's, and claiming JSX
 * for it would be a lie with a fix attached.
 */
function parseAnalysisChunk(code: string): acorn.Program {
    try {
        return acorn.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            // Acorn rejects shebangs by default, and any project bundling its own CLI gets
            // one hoisted to byte 0.
            allowHashBang: true,
        });
    } catch (err) {
        const jsx = classifyJsxParseFailure(code, err);
        if (jsx === null) throw err;
        throw new Error(formatSurvivingJsx(jsx, 'the analysis bundle'), { cause: err });
    }
}

/**
 * Core scanner behind `detectFreeGlobals` (web/Node globals map) and
 * `detectGjsAmbientGlobals` (the `--app node` GJS-ambient set), parametrised so the node
 * path can use a different known-globals set and the stricter host-member handling.
 *
 * "Free" = referenced but never declared in the module
 * (var/let/const/function/class/import/param/catch).
 *
 * A `typeof X` presence-check guard (`typeof document !== 'undefined'`) that is the SOLE
 * occurrence of `X` does NOT count as a use. Such guards are pervasive in isomorphic npm
 * packages; on GJS the guarded branch is dead, but a bundler cannot DCE a `typeof`
 * expression since its value depends on the runtime. Injecting for one of those can hard-
 * error the analysis bundle when the polyfill package is not installed. If `X` also
 * appears in a genuine reference position the injection still fires; the resolvability
 * gate in `auto-globals.ts` covers the remaining case.
 */
function scanFreeGlobals(code: string, opts: ScanOptions): Set<string> {
    const knownGlobals = opts.knownGlobals;
    const methodMarkers = opts.methodMarkers ?? {};
    const wasmMarkers = opts.wasmMarkers ?? {};
    const ast = parseAnalysisChunk(code);

    // Pass 1: every declared name in the module.
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

    // Pass 2: Identifier nodes in reference position, plus `host.X` MemberExpressions
    // where X is a known global. `transform.define` already maps `global`/`window` to
    // `globalThis`, but every host-object name is accepted for safety.
    const freeGlobals = new Set<string>();
    // Globals seen ONLY inside `typeof X` so far; promoted to freeGlobals the moment the
    // name appears in a real-use position, and excluded from injection if it never does.
    const typeofGuardGlobals = new Set<string>();
    const HOST_OBJECTS = new Set(['globalThis', 'global', 'window', 'self', 'globalObject']);

    walk.ancestor(ast, {
        MemberExpression(node: acorn.MemberExpression) {
            // Dot-access only: a computed property is a dynamic Expression, not a name.
            if (node.computed) return;
            if (node.object.type !== 'Identifier') return;
            if (node.property.type !== 'Identifier') return;

            const objName = (node.object as acorn.Identifier).name;
            const propName = (node.property as acorn.Identifier).name;

            // Pattern A: `<host>.X` where the property is itself a known global.
            if (HOST_OBJECTS.has(objName)) {
                if (opts.ignoreHostMembers) return;
                if (knownGlobals.has(propName)) {
                    freeGlobals.add(propName);
                }
                return;
            }

            // Pattern B: METHOD_MARKERS.
            const markerKey = `${objName}.${propName}`;
            const markerTarget = methodMarkers[markerKey];
            if (markerTarget && knownGlobals.has(markerTarget)) {
                freeGlobals.add(markerTarget);
            }
        },
        FunctionDeclaration(node: acorn.FunctionDeclaration) {
            // Pattern C: WASM_BINDGEN_MARKERS, keyed on the function NAME because the
            // body's property access is an unfollowable heap dereference.
            if (!node.id) return;
            const jsName = wbgJsNameFor(node.id.name);
            if (!jsName) return;
            const target = wasmMarkers[jsName];
            if (target && knownGlobals.has(target)) {
                freeGlobals.add(target);
            }
        },
        Identifier(node: acorn.Identifier, ancestors: acorn.AnyNode[]) {
            const name = node.name;
            if (!knownGlobals.has(name)) return;
            if (declaredNames.has(name)) return;

            // Reference position is decided from the parent node.
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
                // Declaration ids are already in declaredNames; guarded anyway.
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
                case 'ImportSpecifier':
                case 'ImportDefaultSpecifier':
                case 'ImportNamespaceSpecifier':
                    return;
                // `typeof X` — presence-check guard, deferred until a real use shows up.
                case 'UnaryExpression': {
                    const unary = parent as acorn.UnaryExpression;
                    if (unary.operator === 'typeof') {
                        if (!freeGlobals.has(name)) {
                            typeofGuardGlobals.add(name);
                        }
                        return;
                    }
                    break;
                }
            }

            // Real use — promote out of the typeof-guard set.
            typeofGuardGlobals.delete(name);
            freeGlobals.add(name);
        },
    });

    return freeGlobals;
}

/**
 * Free identifiers in bundled output that match the known web/Node globals in
 * `GJS_GLOBALS_MAP` — drives `--app gjs --globals auto`. Rules: `scanFreeGlobals`.
 */
export function detectFreeGlobals(code: string): Set<string> {
    return scanFreeGlobals(code, {
        knownGlobals: KNOWN_GLOBALS,
        methodMarkers: METHOD_MARKERS,
        wasmMarkers: WASM_BINDGEN_MARKERS,
    });
}

/**
 * The globals that exist implicitly under gjs but not on Node, seeded on `globalThis` by
 * `@gjsify/node-gi/globals`. The REVERSE of `GJS_GLOBALS_MAP`: the set whose presence
 * makes `--app node` inject that shim. Kept beside the detector so the two never drift.
 */
export const GJS_AMBIENT_GLOBALS: ReadonlySet<string> = new Set([
    'print',
    'printerr',
    'log',
    'logError',
    'ARGV',
    'imports',
]);

/**
 * References to `GJS_AMBIENT_GLOBALS` in a bundled `--app node` chunk — the signal that
 * the bundle needs `@gjsify/node-gi/globals`.
 *
 * Runs on the output AFTER tree-shaking, so a reference behind a statically-dead branch
 * does not trigger injection, and matches only BARE identifiers (`print(...)`,
 * `imports.gi.Gtk`) — see `ignoreHostMembers` for why the host-member form is ignored.
 */
export function detectGjsAmbientGlobals(code: string): Set<string> {
    return scanFreeGlobals(code, {
        knownGlobals: GJS_AMBIENT_GLOBALS,
        ignoreHostMembers: true,
    });
}

import { ALIASES_GJS_FOR_NODE } from '@gjsify/resolve-npm';

/** The node-gi reverse-bridge package every `--app node` GJS shim resolves to. */
const NODE_GI_PACKAGE = '@gjsify/node-gi';

/**
 * The BARE GJS built-ins — the PRE-ALIAS spelling of the same fact, derived from the
 * alias table so the two cannot drift.
 *
 * Both spellings must count because the analysis pass that calls this runs with
 * `nodeGiGlobalsInject` still FALSE: the routing that rewrites `system` →
 * `@gjsify/node-gi/system` has not happened yet, so looking only for the aliased form
 * makes the signal appear AFTER the decision it is supposed to trigger. Measured on
 * adwaita-storybook `--app node`: the final bundle carried `import e from
 * "@gjsify/node-gi/system"` and zero `gi://` — inject never fired, `@girs/*` were
 * emptied to `{}`, nothing was left to rewrite. It passes `node --check` and dies at
 * runtime with `class extends undefined`.
 */
const GJS_BARE_BUILTINS = new Set(Object.keys(ALIASES_GJS_FOR_NODE));

/**
 * Is `source` the `@gjsify/node-gi` package root, one of its subpaths, or the
 * bare GJS built-in that resolves to one on the node target?
 */
function isNodeGiSpecifier(source: unknown): boolean {
    if (typeof source !== 'string') return false;
    if (source === NODE_GI_PACKAGE || source.startsWith(`${NODE_GI_PACKAGE}/`)) return true;
    return GJS_BARE_BUILTINS.has(source);
}

/**
 * A STATIC import of `@gjsify/node-gi` (root or subpath) in a bundled `--app node`
 * chunk — the second genuine-GJS-source signal beside `detectGjsAmbientGlobals`.
 *
 * It is a signal because the bare GJS built-ins are rewritten to
 * `@gjsify/node-gi/<name>` and kept EXTERNAL as top-level imports: a tree-shaken graph
 * that retains one is ALREADY bound to the bridge at load (Node resolves the external
 * at link time and fails without node-gi), so treating it as a GJS-source build cannot
 * cost plain-Node loadability. NOT treating it as one is how a portable GJS app
 * spelling `ARGV` as `system.programArgs` lost its `@girs/*` bodies and its globals
 * shim in one go — `gjsify storybook --runtime node` emitted a bundle with no
 * `requireGi` at all.
 *
 * A surviving `gi://` import is deliberately NOT a signal: its shim loads node-gi LAZILY
 * through a `require('@gjsify/node-gi/gi')` CALL, so this scan is structurally blind to
 * it by design. A cross-platform package with a gjs-gated `gi://` import stays loadable
 * on plain Node (#641, pinned by `tests/e2e/node-gi-globals-inject`), and flipping
 * injection for it would break exactly that.
 *
 * Scans import/re-export STATEMENTS via the AST, never text, so a quoted specifier in a
 * test name or template cannot trigger.
 */
export function detectNodeGiModuleImports(code: string): boolean {
    const ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowHashBang: true,
    });
    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration' && isNodeGiSpecifier(node.source.value)) return true;
        if (
            (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
            node.source &&
            isNodeGiSpecifier(node.source.value)
        ) {
            return true;
        }
    }
    return false;
}
