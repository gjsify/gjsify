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
    'WebAssembly.compile': 'WebAssembly',
    'WebAssembly.compileStreaming': 'WebAssembly',
    'WebAssembly.instantiate': 'WebAssembly',
    'WebAssembly.instantiateStreaming': 'WebAssembly',
    'WebAssembly.validate': 'WebAssembly',
    // Note: URL.createObjectURL / URL.revokeObjectURL don't need markers —
    // they are first-class static methods on @gjsify/url's URL class, so the
    // free `URL` identifier (detected directly, maps to
    // @gjsify/node-globals/register/url in GJS_GLOBALS_MAP) already pulls in
    // the correct register module.
};

/**
 * wasm-bindgen-generated function-name patterns that imply a global
 * identifier should be injected. wasm-bindgen emits its host-API
 * import bindings as top-level functions named
 * `__wbg_<jsName>_<hash>` where `<jsName>` is the property name of the
 * JS API the WASM module wants to call. The body looks like:
 *
 *     function __wbg_crypto_574e78ad8b13b65f(arg0) {
 *         const ret = getObject(arg0).crypto;
 *         return addHeapObject(ret);
 *     }
 *
 * `getObject(arg0)` is a runtime heap dereference (the object is one
 * of the host bridges registered by wasm-bindgen at init time —
 * typically `globalThis`, `window`, or `self`). The MemberExpression
 * visitor can't follow that — `node.object` is a CallExpression, not
 * an Identifier — so the underlying `.crypto` access is invisible to
 * the static scan.
 *
 * Matching on the FUNCTION-NAME pattern instead is high precision
 * (no false positives — `__wbg_` is wasm-bindgen-reserved) and high
 * recall (the names are extremely stable across wasm-bindgen
 * versions). Add an entry whenever a new wasm-bindgen-built npm
 * package surfaces a needed global that the static scan misses.
 *
 * Keyed by the `<jsName>` extracted from the `__wbg_<jsName>_<hash>`
 * function name; value is the gjsify global to inject.
 */
const WASM_BINDGEN_MARKERS: Record<string, string> = {
    // crypto.getRandomValues chain — wasm-bindgen's canonical
    // crypto-import binding pattern. Used by ed25519-dalek, ring, rand
    // (when targeting wasm), and most Rust crates that touch
    // randomness or hashing. Loro is the driving real-world consumer:
    // its CRDT operations need crypto.getRandomValues for peer-id
    // generation and ChangeID nonces.
    crypto: 'crypto',
    getRandomValues: 'crypto',
    // Legacy IE prefix path — wasm-bindgen probes for `msCrypto` as a
    // fallback when `crypto` isn't available. Doesn't apply to GJS
    // (we ship a real `crypto`), but flagging the marker keeps the
    // detector self-documenting.
    msCrypto: 'crypto',
};

/**
 * Match the wasm-bindgen function-name shape — return the `<jsName>`
 * part of `__wbg_<jsName>_<hash>` or `null`. wasm-bindgen hashes are
 * 8–16 hex chars in practice, but we accept any alphanumeric trailer
 * so the pattern survives future format tweaks.
 */
const WBG_NAME_RE = /^__wbg_([A-Za-z][A-Za-z0-9]*)_[A-Za-z0-9]+$/;
function wbgJsNameFor(fnName: string): string | null {
    const match = fnName.match(WBG_NAME_RE);
    return match?.[1] ?? null;
}

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
 * `typeof X` references that appear in presence-check guards
 * (`typeof document !== 'undefined'`) and NOWHERE ELSE in the bundle are
 * NOT counted as free-global uses. Such guards are pervasive in
 * isomorphic npm packages that support both browser and non-browser
 * runtimes; on GJS the guarded branch is dead but the bundler cannot DCE
 * a `typeof` expression (its value depends on the runtime). If the same
 * identifier also appears in a genuine reference position the injection
 * still fires — the typeof-guard suppression only applies when the guard
 * is the SOLE occurrence.
 *
 * If `typeof X` was the ONLY reference to a global AND its polyfill
 * package is unresolvable, silently skipping avoids an unresolved-import
 * hard error at bundle time. The resolvability gate in `auto-globals.ts`
 * provides the second layer of protection for cases where `X` does appear
 * in a real reference position but the package is still absent.
 */
interface ScanOptions {
    /** Identifier set to treat as known globals (the only names ever flagged). */
    knownGlobals: ReadonlySet<string>;
    /** `<host>.<method>` markers → injected identifier. Omitted = none. */
    methodMarkers?: Record<string, string>;
    /** wasm-bindgen `<jsName>` markers → injected identifier. Omitted = none. */
    wasmMarkers?: Record<string, string>;
    /**
     * Do NOT treat `host.X` member expressions (`globalThis.X` / `global.X` /
     * `self.X` / `window.X`) as a trigger at all — only BARE free identifiers.
     *
     * The default (false) keeps Pattern A firing, which is the long-standing GJS
     * `--globals auto` behaviour (some packages legitimately read
     * `globalThis.Buffer`). The `--app node` GJS-ambient detector turns it ON:
     * genuine GJS source uses the BARE forms (`print(...)`, `imports.gi.Gtk`),
     * while the `globalThis.imports` / `globalThis.print` member form is the
     * cross-platform ISOMORPHIC-GUARD shape (`if (typeof globalThis.imports !==
     * 'undefined') { … }`) a package uses to branch on GJS. Injecting
     * `@gjsify/node-gi/globals` for that would break plain-Node loadability of
     * such a package (the bare external import is unresolvable without node-gi,
     * and the shim eagerly loads the native addon) — the exact #641/#644
     * gated-load regression. So on the node target host-member forms are ignored.
     */
    ignoreHostMembers?: boolean;
}

/**
 * Core scanner shared by `detectFreeGlobals` (web/Node globals map) and
 * `detectGjsAmbientGlobals` (the `--app node` GJS-ambient set). Parametrised so
 * the GJS path stays byte-identical while the node path can use a different
 * known-globals set + the stricter host-member typeof handling.
 */
function scanFreeGlobals(code: string, opts: ScanOptions): Set<string> {
    const knownGlobals = opts.knownGlobals;
    const methodMarkers = opts.methodMarkers ?? {};
    const wasmMarkers = opts.wasmMarkers ?? {};
    const ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // Some bundled chunks carry an embedded `#!shebang` line —
        // notably any project bundling its own CLI gets the
        // `#!/usr/bin/env -S gjs -m` shebang hoisted to byte 0.
        // Acorn rejects shebangs by default; allow them so the
        // free-globals analyzer doesn't choke on its own input.
        allowHashBang: true,
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
    // Globals seen only inside `typeof X` expressions so far. Moved into
    // freeGlobals the moment the same name is detected in a real-use
    // position. Names that remain here at the end were only ever
    // presence-checked — not genuinely used — and are excluded from the
    // injection set (see JSDoc above).
    const typeofGuardGlobals = new Set<string>();
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
                // The node GJS-ambient detector ignores host-member forms — they
                // are the isomorphic-guard shape, not genuine GJS source (see
                // `ignoreHostMembers`). Bare-identifier detection still applies.
                if (opts.ignoreHostMembers) return;
                if (knownGlobals.has(propName)) {
                    freeGlobals.add(propName);
                }
                return;
            }

            // Pattern B: known-instance method markers like
            // `navigator.getGamepads` → marker map forwards to a global
            // identifier that triggers the right register path even though
            // the identifier itself never appears in the bundle.
            const markerKey = `${objName}.${propName}`;
            const markerTarget = methodMarkers[markerKey];
            if (markerTarget && knownGlobals.has(markerTarget)) {
                freeGlobals.add(markerTarget);
            }
        },
        FunctionDeclaration(node: acorn.FunctionDeclaration) {
            // Pattern C: wasm-bindgen marker hook. The function name
            // matches `__wbg_<jsName>_<hash>` and `<jsName>` is a known
            // host API. The body would be `getObject(arg0).<jsName>` —
            // an unfollowable runtime heap dereference — but the
            // function NAME tells us exactly which global is needed.
            // See WASM_BINDGEN_MARKERS for the why + which jsNames are
            // mapped.
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

            // Quick filter: only check known globals
            if (!knownGlobals.has(name)) return;

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
                // `typeof X` — presence-check guard. Defer: record in the
                // typeof-guard set and only promote to freeGlobals if the
                // same name also appears in a real-use position elsewhere
                // in the bundle. See JSDoc on detectFreeGlobals.
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

            // Real-use position. Promote from typeofGuardGlobals if
            // this name was previously seen only as a typeof argument.
            typeofGuardGlobals.delete(name);
            freeGlobals.add(name);
        },
    });

    return freeGlobals;
}

/**
 * Parse bundled JS output and return the set of free (unbound) identifiers that
 * match the known web/Node GJS globals from `GJS_GLOBALS_MAP`. Drives the
 * `--app gjs --globals auto` injection. See `scanFreeGlobals` for the rules.
 */
export function detectFreeGlobals(code: string): Set<string> {
    return scanFreeGlobals(code, {
        knownGlobals: KNOWN_GLOBALS,
        methodMarkers: METHOD_MARKERS,
        wasmMarkers: WASM_BINDGEN_MARKERS,
    });
}

/**
 * The GJS ambient globals that exist implicitly under gjs but not on Node:
 * `print`/`printerr`/`log`/`logError`, the `ARGV` array, and the legacy
 * `imports` object (`imports.gi.Gtk`, `imports.system`, `imports.gettext`).
 * `@gjsify/node-gi/globals` seeds these on `globalThis` when imported.
 *
 * This is the REVERSE of `GJS_GLOBALS_MAP` (which maps Node/Web globals onto
 * GJS): it's the set the `--app node` target injects the node-gi globals shim
 * for. Kept here next to the detector so the two never drift.
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
 * Detect references to the GJS ambient globals (`GJS_AMBIENT_GLOBALS`) in a
 * bundled `--app node` chunk — the signal that the bundle needs
 * `@gjsify/node-gi/globals` injected.
 *
 * Runs on the bundled output AFTER tree-shaking (same property the GJS path
 * relies on), so a `print`/`imports` reference behind a statically-dead branch
 * does not trigger injection. Detects only BARE free identifiers — the genuine
 * GJS-source shape (`print(...)`, `imports.gi.Gtk`). The `globalThis.imports` /
 * `globalThis.print` host-member form is the cross-platform isomorphic-GUARD
 * shape (`if (typeof globalThis.imports !== 'undefined') { … }`) and is
 * deliberately ignored: injecting `@gjsify/node-gi/globals` for it would break
 * plain-Node loadability of a package that merely gates GJS usage (the bare
 * external import is unresolvable without node-gi; the shim eagerly loads the
 * native addon). Pure `typeof imports` probes are deferred too. See
 * `ignoreHostMembers`.
 */
export function detectGjsAmbientGlobals(code: string): Set<string> {
    return scanFreeGlobals(code, {
        knownGlobals: GJS_AMBIENT_GLOBALS,
        ignoreHostMembers: true,
    });
}

/** The node-gi reverse-bridge package every `--app node` GJS shim resolves to. */
import { ALIASES_GJS_FOR_NODE } from '@gjsify/resolve-npm';

const NODE_GI_PACKAGE = '@gjsify/node-gi';

/**
 * The BARE GJS built-ins, i.e. the PRE-ALIAS spelling of the same fact.
 * Derived from the alias table so the two cannot drift.
 *
 * Why both spellings must count: the analysis pass that calls this runs with
 * `nodeGiGlobalsInject` still FALSE, so the GJS-source routing that rewrites
 * `system` → `@gjsify/node-gi/system` has not happened yet. Looking only for
 * the aliased form makes the signal appear only AFTER the decision it is
 * supposed to trigger — chicken-and-egg, and the same shape as the bug this
 * detector was added to fix.
 *
 * Measured (CI, adwaita-storybook `--app node`): the FINAL bundle carries
 * `import e from "@gjsify/node-gi/system"` and zero `gi://`, because the
 * inject never fired, `@girs/*` were emptied to `{}`, and nothing was left to
 * rewrite. The bundle then passes `node --check` and dies at runtime with
 * `class extends undefined`.
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
 * Detect a STATIC import of `@gjsify/node-gi` (root or any subpath) in a
 * bundled `--app node` chunk — the second genuine-GJS-source signal next to
 * `detectGjsAmbientGlobals`.
 *
 * Why this is a signal: the bare GJS built-in modules (`system`/`gettext`/
 * `cairo`) are rewritten to `@gjsify/node-gi/<name>` and kept EXTERNAL as
 * top-level import statements, so any bundle whose tree-shaken graph retains
 * one is ALREADY bound to the bridge at load — Node resolves the external at
 * link time and fails without node-gi installed. Treating that bundle as a
 * GJS-source build therefore cannot cost plain-Node loadability; NOT treating
 * it as one is how a portable GJS app that spells `ARGV` as
 * `system.programArgs` (the AGENTS.md-mandated spelling) lost its `@girs/*`
 * bodies and its globals shim in one go — `gjsify storybook --runtime node`
 * emitted a bundle with no `requireGi` at all.
 *
 * Why a surviving `gi://` import is deliberately NOT a signal: its shim loads
 * node-gi LAZILY through a `require('@gjsify/node-gi/gi')` CALL — not an import
 * statement, so this scan is structurally blind to it, by design. A
 * cross-platform package with a gjs-gated `gi://` import stays loadable on
 * plain Node (the #641 lesson, pinned by `tests/e2e/node-gi-globals-inject`),
 * and flipping injection for it would break exactly that.
 *
 * Scans import/re-export STATEMENTS via the AST (never text), so a quoted
 * `'@gjsify/node-gi/system'` inside a test name or template cannot trigger.
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
