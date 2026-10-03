// A bare ASSIGNMENT to an undeclared `window` is rewritten to `globalThis.window = …`.
//
// ADR 0079 dropped the `window` define on `--app node`, and code that was only green
// because the define supplied the binding came apart. Excalibur 0.32.0's
// `src/engine/polyfill.ts` opens with
//
//     if (typeof window === 'undefined') { window = <any>{ audioContext() { return; } }; }
//
// An ES module body is strict, so the write is a `ReferenceError` on every runtime that
// has no `window` — the branch has never been able to run (PixelRPG/map-editor#300), and
// on GJS or in a browser the guard is false, so nothing noticed. `globalThis.window = …`
// is the same statement with the author's intent spelled out, and it holds everywhere.
//
// NOT A DEFINE AND NOT A REGISTER (ADR 0079's addendum). A define rewrites the very
// `typeof` guard that decides the branch — the @mtcute/web failure ADR 0079 documents —
// and a register that defines `window` flips every guard in the ecosystem. The guard
// stays a guard, and nothing anywhere defines `window`.
//
// WHY ALL FOUR TARGETS AND NOT THE TWO THAT NEED IT, measured on the bundled artifact of
// the shape above. On `--app node` and `--app nativescript` the plugin IS the fix: without
// it the `--app node` bundle dies at load with `ReferenceError: window is not defined`,
// and with it the same bundle runs and the author's `audioContext` stub is there. On the
// two targets that DO define `window`, the `define` replaces the assignment TARGET too —
// `window = {…}` becomes `globalThis = {…}`, which REPLACES THE WHOLE GLOBAL OBJECT — and a
// plugin `transform` runs before it, so the line is already `globalThis.window = {…}` and
// the define finds nothing left to rewrite. There the branch is dead anyway (the host has
// a `window`), but the artifact that would ship if it ever ran is no longer a bomb.
//
// WHY AN AST AND NOT A TEXT PASS: the question is "is `window` a BINDING in scope at
// this assignment", which no regex answers. `window.x = 1`, `foo.window = 1`,
// `{ window: 1 }`, `typeof window` and a `window` that is a parameter of the enclosing
// function all share the bytes of the shape, and rewriting a local binding would
// silently retarget a program that means something else. Same reason
// `utils/detect-free-globals.ts` parses.
//
// THE FIVE REFUSALS, each where its fact is knowable:
//  - a member expression on the left (`window.x = 1`, `(<any>window).foo = 1`): a write
//    ONTO the runtime's own window, which is exactly what the guarded branches around it
//    do, and no error to fix;
//  - an assignment whose `window` a `var`/`let`/`const`, a parameter, a `catch` binding, a
//    function or class name, or an import binds: a local variable, not a global;
//  - an ARITHMETIC compound assignment (`window += 1`): its left side is a value USE, and
//    rewriting it would turn the `ReferenceError` a Node build raises into a silent `NaN`.
//    `||=`, `&&=` and `??=` are the opposite case — the read is the author's own "unless
//    there already is one", so the modern idiom is rewritten with `=`;
//  - a module containing `with`: the binding is dynamic there, and no static pass can see
//    which object supplies it;
//  - a source the pinned parser cannot read: the module keeps the bug and the bundler
//    reports the parse itself, loudly and with its own position. The measured list is
//    `utils/scan-named-imports.ts`'s (`satisfies`, a `const` type parameter) plus
//    acorn-typescript 1.4.13's blind spot on an angle-bracket assertion — `window =
//    <any>{…}`, which is how Excalibur's SOURCE spells the line and what its shipped
//    dist (the shape a build actually reads) has already erased.

import type * as acorn from 'acorn';
import type { Plugin } from 'rolldown';

import { extractBindingNames } from '../utils/detect-free-globals.js';
import { parseSource } from '../utils/inline-static-reads.js';
import { REWRITE_FILTER } from './rewrite-node-modules-paths.js';

/** The plugin's name — what the four app orchestrators are pinned on. */
export const WINDOW_ASSIGN_PLUGIN = 'gjsify-window-assign';

/** The name whose free assignment is this plugin's whole subject. */
const WINDOW = 'window';

/** Where the write lands: the global object, on every runtime there is one (ADR 0079). */
const GLOBAL_WINDOW = 'globalThis.window';

/** Operators whose left side is a PLACE — see the third refusal for what is absent. */
const PLACE_ASSIGNMENTS: ReadonlySet<string> = new Set(['=', '||=', '&&=', '??=']);

/**
 * The minimum shape this descent reads off a node, TypeScript or plain ESTree.
 *
 * Structural rather than `acorn.Node` so a TS node type the parser invents is data the
 * descent carries, not a type it has to learn: `walk.simple` throws `No walker function
 * defined for node type TSInterfaceDeclaration` on the first interface in a first-party
 * source, which is why `utils/scan-named-imports.ts` descends generically.
 */
interface SrcNode {
    readonly type: string;
    readonly start: number;
    readonly end: number;
    readonly operator?: string;
    readonly left?: SrcNode;
    readonly name?: string;
    readonly id?: SrcNode | null;
    readonly params?: readonly SrcNode[];
    readonly local?: SrcNode;
    readonly param?: SrcNode | null;
}

/** `extractBindingNames` speaks acorn's node union, which a generic descent cannot be. */
const asAcornNode = (node: SrcNode): acorn.AnyNode => node as unknown as acorn.AnyNode;

/** Half-open source range of one identifier to replace. */
export interface WindowAssignment {
    /** Inclusive start offset. */
    readonly start: number;
    /** Exclusive end offset. */
    readonly end: number;
}

interface Candidate extends WindowAssignment {
    /** Enclosing scope roots, innermost first. */
    readonly roots: readonly SrcNode[];
}

/**
 * A container a `var`/lexical binding is scoped to: the function, or the module.
 *
 * A BLOCK is deliberately not one. Precision is needed between functions — a parameter
 * named `window` in one function does not bind the name in its neighbour — and every
 * coarsening above this line (a block, or a hoisted name marked in the scope enclosing the
 * function it is written in) can only LOSE a rewrite, never retarget a program.
 */
function isScopeRoot(node: SrcNode): boolean {
    switch (node.type) {
        case 'Program':
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        // Bodyless TypeScript overload signatures still bind their parameters.
        case 'TSDeclareFunction':
        case 'TSDeclareMethod':
        case 'TSEmptyBodyFunctionExpression':
            return true;
        default:
            return false;
    }
}

function bindsName(pattern: SrcNode | null | undefined): boolean {
    if (pattern === null || pattern === undefined) return false;
    return extractBindingNames(asAcornNode(pattern)).includes(WINDOW);
}

/** Does this node BIND `window`, such that a read of `window` here would find it? */
function bindsWindow(node: SrcNode): boolean {
    switch (node.type) {
        case 'VariableDeclarator':
            return bindsName(node.id);
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'TSDeclareFunction':
        case 'TSDeclareMethod':
        case 'TSEmptyBodyFunctionExpression':
            return node.id?.name === WINDOW || (node.params?.some((param) => bindsName(param)) ?? false);
        case 'ClassDeclaration':
        case 'ClassExpression':
            return node.id?.name === WINDOW;
        case 'CatchClause':
            return bindsName(node.param);
        case 'ImportSpecifier':
        case 'ImportDefaultSpecifier':
        case 'ImportNamespaceSpecifier':
            return node.local?.name === WINDOW;
        default:
            return false;
    }
}

/**
 * Does this node's name bind OUTSIDE it as well?
 *
 * A `function`/`class` DECLARATION's name is hoisted into the enclosing scope like a
 * `var`, so `function window() {}` hides the name from its module; a PARAMETER binds only
 * inside its function, which is why a neighbouring function's `window` parameter must not
 * cost the module its rewrite.
 */
function hoistsNameOutward(node: SrcNode): boolean {
    switch (node.type) {
        case 'FunctionDeclaration':
        case 'ClassDeclaration':
        case 'TSDeclareFunction':
            return node.id?.name === WINDOW;
        default:
            return false;
    }
}

function isFreeAssignment(node: SrcNode, left: SrcNode | undefined): boolean {
    if (node.type !== 'AssignmentExpression') return false;
    // A member expression on the left is a write ONTO the window the runtime has, not a
    // write of one — the first refusal, and the reason `left.type` is asked at all.
    if (left?.type !== 'Identifier' || left.name !== WINDOW) return false;
    return PLACE_ASSIGNMENTS.has(node.operator ?? '');
}

function collectCandidates(ast: SrcNode): { edits: WindowAssignment[] | null } {
    const candidates: Candidate[] = [];
    // Every scope root that binds `window` somewhere inside it.
    const boundRoots = new Set<SrcNode>();
    let hasWith = false;

    const stack: { node: SrcNode; roots: readonly SrcNode[] }[] = [{ node: ast, roots: [] }];
    while (stack.length > 0) {
        const frame = stack.pop() as { node: SrcNode; roots: readonly SrcNode[] };
        const { node, roots } = frame;
        // A function's own name and parameters bind in ITS scope, so a node that opens a
        // scope joins the chain before it is asked what it binds.
        const nodeRoots = isScopeRoot(node) ? [node, ...roots] : roots;

        if (node.type === 'WithStatement') hasWith = true;
        if (bindsWindow(node)) {
            // The NEAREST enclosing root — index 0, the chain is innermost-first — and only
            // that one. Marking every root up the chain would degrade this into a
            // module-wide "does any declaration anywhere mention window" test, which loses
            // the rewrite for a module whose unrelated function takes a `window` parameter.
            const nearest = nodeRoots[0];
            if (nearest) boundRoots.add(nearest);
            if (nearest && hoistsNameOutward(node)) {
                const enclosing = nodeRoots[1];
                if (enclosing) boundRoots.add(enclosing);
            }
        }
        if (isFreeAssignment(node, node.left)) {
            const left = node.left as SrcNode;
            candidates.push({ start: left.start, end: left.end, roots: nodeRoots });
        }

        for (const child of childrenOf(node)) stack.push({ node: child, roots: nodeRoots });
    }

    // A binding in scope for an assignment is declared in one of its ENCLOSING roots, so
    // walking the chain is what makes the rewrite safe — an undeclared `window` has none.
    // `with` is refused here rather than above: its answer is "no idea", not "rewrite".
    if (hasWith) return { edits: null };
    return {
        edits: candidates
            .filter((candidate) => !candidate.roots.some((root) => boundRoots.has(root)))
            .map(({ start, end }) => ({ start, end })),
    };
}

/** Every own-property value that is a node — `Object.values` order is irrelevant here. */
function childrenOf(node: SrcNode): SrcNode[] {
    const out: SrcNode[] = [];
    for (const value of Object.values(node as unknown as Record<string, unknown>)) {
        if (Array.isArray(value)) {
            for (const item of value) pushIfNode(item, out);
            continue;
        }
        pushIfNode(value, out);
    }
    return out;
}

function pushIfNode(value: unknown, out: SrcNode[]): void {
    if (value === null || typeof value !== 'object') return;
    if (typeof (value as { type?: unknown }).type !== 'string') return;
    out.push(value as SrcNode);
}

/**
 * The free `window` assignments in `code`, or `null` when the module cannot be read —
 * the whole module in the `with` case, since its bindings there are dynamic.
 */
export function findWindowAssignments(code: string, id: string): WindowAssignment[] | null {
    let ast: SrcNode;
    try {
        // Extension-aware (a `.ts` source arrives with its type syntax intact), and the
        // shared parser this package already parses source with — not a second copy.
        ast = parseSource(code, id) as unknown as SrcNode;
    } catch {
        return null;
    }
    return collectCandidates(ast).edits;
}

/** `code` with every free `window` assignment rewritten, or null when it needs none. */
export function rewriteWindowAssignments(code: string, id: string): string | null {
    const edits = findWindowAssignments(code, id);
    if (!edits || edits.length === 0) return null;
    // Descending, so each splice leaves the offsets of the ones after it valid.
    let out = code;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + GLOBAL_WINDOW + out.slice(edit.end);
    }
    return out;
}

/**
 * Composed by ALL FOUR `--app` targets (ADR 0079's addendum) — for the measured reason in
 * the header: it is the fix on node and nativescript, and on gjs and browser it keeps the
 * `window` define from turning the assignment target into `globalThis = …`.
 */
export function windowAssignPlugin(): Plugin {
    return {
        name: WINDOW_ASSIGN_PLUGIN,
        transform: {
            filter: { id: REWRITE_FILTER },
            handler(code, id) {
                // Re-applied inside the handler, the way `react-native-gate.ts` does: the
                // object form is engine plumbing (under GJS `filter.id` is lifted into a
                // plugin-level `idFilter`), and a source rewrite must not depend on
                // plumbing to stay off `.css`, `.blp` and a data URL, none of which acorn
                // can read.
                if (!REWRITE_FILTER.test(id)) return null;
                const out = rewriteWindowAssignments(code, id);
                return out === null ? null : { code: out, map: null };
            },
        },
    };
}
