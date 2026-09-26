// Give a module that ASSIGNS the global `console` a local binding of its own, so the
// `--app gjs` console `inject` leaves it alone.
//
// `--app gjs` rewrites every free `console` into an import from `shims/console-gjs`
// (rolldown `transform.inject`), because GJS defines `globalThis.console` non-writable
// and non-configurable. An import binding cannot be assigned, so ONE sloppy-mode
// `console = { log() {} }` anywhere in the dependency graph failed the whole build with
// `ASSIGN_TO_IMPORT: Cannot assign to import 'console'`. Measured: `node-forge`'s
// `lib/log.js` does exactly that on its browser-without-console branch, and it reaches
// `wxt` through `web-ext`, so `gjsify exec wxt` could not be rebuilt at all.
//
// The binding is `var console = globalThis.console`: the module keeps working with the
// runtime's console, and its assignment lands on its own variable — which is all a
// sloppy-mode write to a non-writable global ever did under GJS. Only such a module
// gives up the shim's print()-based output; every other module is untouched.
//
// Detection is an AST question (a parameter or a `const console` is a binding, not an
// assignment to the global), asked only of sources the cheap pattern admits.

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { Plugin } from 'rolldown';
import { extractBindingNames } from '../utils/detect-free-globals.js';

const CANDIDATE_RE = /(?:^|[^.\w$])console\s*=(?![=>])/;
const SOURCE_RE = /\.(?:m|c)?jsx?$/;

export const CONSOLE_LOCAL_BINDING = 'var console = globalThis.console;';

function parse(code: string): acorn.Program | null {
    const base = { ecmaVersion: 'latest', allowHashBang: true, allowAwaitOutsideFunction: true } as const;
    try {
        return acorn.parse(code, { ...base, sourceType: 'module' });
    } catch {
        // Sloppy CJS (the node-forge case: `with`, legacy octals, top-level `return`)
        // is not a valid module; the script grammar is the one it was written in.
    }
    try {
        return acorn.parse(code, { ...base, sourceType: 'script', allowReturnOutsideFunction: true });
    } catch {
        // Not JavaScript acorn can read (a syntax newer than acorn): leave it to the
        // bundler, which reports an assignment it cannot bundle loudly on its own.
        return null;
    }
}

/**
 * Where to insert the local binding in `code`, or null when the module does not assign
 * the GLOBAL `console`. Null as well when the module declares a `console` anywhere: its
 * assignments may target that binding, and declaring a second one would not parse.
 * The offset is after the directive prologue, so a `'use strict'` stays a directive.
 */
export function freeConsoleAssignmentInsertion(code: string): number | null {
    if (!CANDIDATE_RE.test(code)) return null;
    const ast = parse(code);
    if (!ast) return null;

    let declares = false;
    let assigns = false;
    const bindsConsole = (node: acorn.AnyNode | null | undefined): boolean =>
        !!node && extractBindingNames(node).includes('console');
    walk.full(ast, (node) => {
        switch (node.type) {
            case 'VariableDeclarator':
                if (bindsConsole(node.id)) declares = true;
                break;
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                if (bindsConsole(node.id) || node.params.some((p) => bindsConsole(p))) declares = true;
                break;
            case 'ClassDeclaration':
            case 'ClassExpression':
                if (bindsConsole(node.id)) declares = true;
                break;
            case 'CatchClause':
                if (bindsConsole(node.param)) declares = true;
                break;
            case 'ImportSpecifier':
            case 'ImportDefaultSpecifier':
            case 'ImportNamespaceSpecifier':
                if (node.local.name === 'console') declares = true;
                break;
            case 'AssignmentExpression':
                if (bindsConsole(node.left)) assigns = true;
                break;
        }
    });
    if (!assigns || declares) return null;

    let offset = 0;
    for (const statement of ast.body) {
        if (statement.type !== 'ExpressionStatement' || !('directive' in statement)) break;
        offset = statement.end;
    }
    return offset;
}

/** `code` with the local `console` binding inserted, or null when it needs none. */
export function bindConsoleLocally(code: string): string | null {
    const at = freeConsoleAssignmentInsertion(code);
    if (at === null) return null;
    // No newline, so every later line keeps its number; after a directive the `;` ends
    // it even when the source relied on ASI (`'use strict'\n`).
    const sep = at === 0 ? '' : ';';
    return `${code.slice(0, at)}${sep}${CONSOLE_LOCAL_BINDING}${code.slice(at)}`;
}

/** Composed by `--app gjs` whenever the console shim is injected. */
export function consoleAssignPlugin(): Plugin {
    return {
        name: 'gjsify-console-assign',
        transform: {
            filter: { id: SOURCE_RE },
            handler(code, id) {
                if (!SOURCE_RE.test(id)) return null;
                const out = bindConsoleLocally(code);
                return out === null ? null : { code: out, map: null };
            },
        },
    };
}
