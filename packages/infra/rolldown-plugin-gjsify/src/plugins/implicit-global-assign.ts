// A bare ASSIGNMENT to an UNDECLARED identifier is rewritten to `globalThis.X = …`.
//
// ADR 0079 dropped the `window` define on `--app node`, and code that was only green
// because the define supplied the binding came apart. Excalibur 0.32.0's
// `src/engine/polyfill.ts` opens with
//
//     if (typeof window === 'undefined') { window = <any>{ audioContext() { return; } }; }
//
// An ES module body is strict, so the write is a `ReferenceError` on every runtime that
// has no `window` — the branch has never been able to run (PixelRPG/map-editor#300), and
// on GJS or in a browser the guard is false, so nothing noticed.
//
// `window` is the MOTIVATING case, not the subject. The bug is sloppy mode's IMPLICIT
// GLOBAL CREATION, and it is not window-shaped: `self = …`, `document = …` and `foo = 1` in
// a CommonJS file the bundler wrapped into a strict ES module all die the same way, and
// only the first of them has an ADR behind it. So the subject here is any identifier no
// enclosing scope binds, and `globalThis.X = …` is that same statement with the author's
// intent spelled out — it holds on Node, Bun, Deno, GJS and in a page alike.
//
// NOT A DEFINE AND NOT A REGISTER (ADR 0079's addendum). A define rewrites the very
// `typeof` guard that decides the branch — the @mtcute/web failure ADR 0079 documents —
// and a register that defines `window` flips every guard in the ecosystem. The guard stays a
// guard and nothing anywhere defines a global, so no allowlist is needed either: writing a
// global the runtime ALREADY has (`onerror = fn`, `self = globalThis`) is legal in strict
// mode, which makes `globalThis.X = …` an identity rather than a change.
//
// WHY ALL FOUR TARGETS AND NOT THE TWO THAT NEED IT, measured on the bundled artifact of
// the shape above. On `--app node` and `--app nativescript` the plugin IS the fix: without
// it the `--app node` bundle dies at load with `ReferenceError: window is not defined`,
// and with it the same bundle runs and the author's `audioContext` stub is there. On the
// two targets that DO define `window`, the `define` replaces the assignment TARGET too —
// `window = {…}` becomes `globalThis = {…}`, which REPLACES THE WHOLE GLOBAL OBJECT — and a
// plugin `transform` runs before it, so the line is already `globalThis.window = {…}` and
// the define finds nothing left to rewrite.
//
// WHY AN AST AND NOT A TEXT PASS: the question is "is X a BINDING in scope at this
// assignment", which no regex answers. `X.y = 1`, `foo.X = 1`, `{ X: 1 }`, `typeof X` and
// an `X` that is a parameter of the enclosing function all share the bytes of the shape,
// and rewriting a local binding would silently retarget a program that means something
// else. Same reason `utils/detect-free-globals.ts` parses.
//
// ONE WALK FOR EVERY NAME. The descent records bindings as ROOT → the names bound in it,
// rather than answering "is `window` bound" for one name at a time: a module has as many
// implicit globals as it has typos, and re-walking per name made the pass quadratic for an
// answer that is one set lookup once the chain is there.
//
// THE REFUSALS, each where its fact is knowable:
//  - a member expression on the left (`X.y = 1`, `foo.X = 1`): a write ONTO a runtime
//    object, which is exactly what the guarded branches around the Excalibur assignment do,
//    and no error to fix;
//  - an assignment whose name a `var`/`let`/`const`, a parameter, a `catch` binding, a
//    function or class name, or an import binds: a local variable, not a global;
//  - an ARITHMETIC compound assignment (`X += 1`) and `X++`/`X--`: their left side is a
//    value USE, so sloppy mode threw there too and rewriting would trade that
//    `ReferenceError` for a silent `NaN`. `||=`, `&&=` and `??=` read the name too, so on
//    an undeclared one sloppy mode threw there as well and they stay untouched;
//  - a name that can never be an implicit global (below): it is a binding, an unassignable
//    global, or a `SyntaxError` before this pass ever sees it;
//  - a module containing `with`: the binding is dynamic there, and no static pass can see
//    which object supplies it;
//  - a source the pinned parser cannot read: the module keeps the bug and the bundler
//    reports the parse itself, loudly and with its own position. The measured list is
//    `utils/scan-named-imports.ts`'s (`satisfies`, a `const` type parameter) plus
//    acorn-typescript 1.4.13's blind spot on an angle-bracket assertion — `window =
//    <any>{…}`, which is how Excalibur's SOURCE spells the line and what its shipped
//    dist (the shape a build actually reads) has already erased.
//
// NOT HANDLED: a DESTRUCTURING target (`({ a, b } = obj)`) keeps its bare names.
// `extractBindingNames` yields names, not source ranges, so a pattern would need a second
// positional walk over every pattern shape (defaults, rest, computed keys) that nothing
// here already carries — an implicit global spelled `({ foo } = obj)` stays broken until
// that walk exists. `for (X in/of …)` IS handled, because its left is the same bare
// `Identifier` the assignment case already asks for, and sloppy mode created that `X` too.

import type * as acorn from 'acorn';
import type { Plugin } from 'rolldown';

import { extractBindingNames } from '../utils/detect-free-globals.js';
import { parseSource } from '../utils/inline-static-reads.js';
import { REWRITE_FILTER } from './rewrite-node-modules-paths.js';

/** The plugin's name — what the four app orchestrators are pinned on. */
export const IMPLICIT_GLOBAL_ASSIGN_PLUGIN = 'gjsify-implicit-global-assign';

/**
 * Names that are never an implicit global, whatever the scope says.
 *
 * `undefined`/`NaN`/`Infinity` are non-writable own properties of the global object, so
 * assigning to them is a `TypeError` in strict mode and a silent no-op in sloppy mode —
 * never the `ReferenceError` this plugin exists for, and `globalThis.` would only spell the
 * same failure out. `arguments` and `eval` are rejected by the parser in a strict body
 * (`SyntaxError: Unexpected eval or arguments`), so they cannot reach a build; they are
 * listed because a name this pass must not rewrite should not depend on that. `globalThis`
 * IS a writable global property on every runtime, so `globalThis = x` already works — and
 * rewriting it would write the property through itself.
 *
 * The CommonJS WRAPPER bindings are here for a measured reason, and it is the incident that
 * put them in the set rather than a rule of thumb: `exports`, `module`, `require`,
 * `__filename` and `__dirname` are parameters of the function the bundler wraps a
 * CommonJS module in, so `exports = module.exports = require('./lib/_stream_readable.js')`
 * — `readable-stream/readable.js`, the polyfill behind `node:stream` — is a LOCAL write. The
 * descent cannot see the wrapper, because it parses with `sourceType: 'module'`, so the pass
 * rewrote it to `globalThis.exports = …`: `module.exports` was still set, but every
 * `exports.Writable = require('./lib/_stream_writable.js')` beside it landed on the wrapper's
 * original object, which nothing returns. Measured on a bundle of `readable-stream` with and
 * without the plugin: `Writable`, `Duplex`, `Transform`, `PassThrough` and `Readable` went
 * from `function` to `undefined` with no error anywhere — and a consumer that inherits from
 * one of them is what throws next, as `util.inherits(Child, undefined)`. The same line
 * appears in every bundled copy of `semver`, whose default import is what a Babel-based
 * plugin bundle then calls. Refusing them unconditionally costs one rewrite that no build
 * can use: in an ES module these names resolve to nothing at all.
 */
const NEVER_IMPLICIT_GLOBAL: ReadonlySet<string> = new Set([
    'undefined',
    'NaN',
    'Infinity',
    'arguments',
    'eval',
    'globalThis',
    // The CommonJS wrapper parameters — a local write in the module that has them.
    'exports',
    'module',
    'require',
    '__filename',
    '__dirname',
]);

/** Where the write lands: the global object, on every runtime there is one (ADR 0079). */
const GLOBAL_PREFIX = 'globalThis.';

/** Operators whose left side is a PLACE — see the third refusal for what is absent. */
const PLACE_ASSIGNMENTS: ReadonlySet<string> = new Set(['=']);

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

/** One free assignment: the identifier to prefix, and the name that was free. */
export interface ImplicitGlobalAssignment {
    /** The undeclared name — the property the rewrite writes. */
    readonly name: string;
    /** Inclusive start offset. */
    readonly start: number;
    /** Exclusive end offset. */
    readonly end: number;
}

interface Candidate extends ImplicitGlobalAssignment {
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

/** Every name this node binds in the scope it stands in, empty when it binds none. */
function bindingNames(node: SrcNode): readonly string[] {
    switch (node.type) {
        case 'VariableDeclarator':
            return node.id ? extractBindingNames(asAcornNode(node.id)) : [];
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'TSDeclareFunction':
        case 'TSDeclareMethod':
        case 'TSEmptyBodyFunctionExpression': {
            // A function's own name and its parameters bind in ITS scope, so the chain is
            // already one root deeper by the time this is asked.
            const names: string[] = node.id?.name === undefined ? [] : [node.id.name];
            for (const param of node.params ?? []) names.push(...extractBindingNames(asAcornNode(param)));
            return names;
        }
        case 'ClassDeclaration':
        case 'ClassExpression':
            return node.id?.name === undefined ? [] : [node.id.name];
        case 'CatchClause':
            return node.param ? extractBindingNames(asAcornNode(node.param)) : [];
        case 'ImportSpecifier':
        case 'ImportDefaultSpecifier':
        case 'ImportNamespaceSpecifier':
            return node.local?.name === undefined ? [] : [node.local.name];
        default:
            return [];
    }
}

/**
 * Does `name` bind OUTSIDE this node as well?
 *
 * A `function`/`class` DECLARATION's name is hoisted into the enclosing scope like a
 * `var`, so `function window() {}` hides the name from its module; a PARAMETER binds only
 * inside its function, which is why a neighbouring function's `window` parameter must not
 * cost the module its rewrite.
 */
function hoistsOutward(node: SrcNode, name: string): boolean {
    switch (node.type) {
        case 'FunctionDeclaration':
        case 'ClassDeclaration':
        case 'TSDeclareFunction':
            return node.id?.name === name;
        default:
            return false;
    }
}

/**
 * The bare identifier a statement writes to, or null.
 *
 * Both accepted shapes are an implicit global in sloppy mode, so both become a write to the
 * global object; everything else here is a refusal, and the reason is at each branch.
 */
function freeTarget(node: SrcNode): SrcNode | null {
    if (node.type === 'AssignmentExpression') {
        // A member expression on the left is a write ONTO a runtime object, not a write of
        // one — the first refusal, and the reason `left.type` is asked at all.
        if (node.left?.type !== 'Identifier') return null;
        // Every compound operator (`+=`, `||=`, `??=`, …) and `++` READS the left side
        // first, so on an undeclared name sloppy mode threw there too: only plain `=` creates.
        return PLACE_ASSIGNMENTS.has(node.operator ?? '') ? node.left : null;
    }
    // `for (X in/of …)` declares `X` in sloppy mode exactly as `X = …` does, and its left
    // is the same bare Identifier — so it costs nothing to accept here. A `for (var X …)`
    // or `for (const X …)` left is a VariableDeclaration and never reaches this branch.
    if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
        return node.left?.type === 'Identifier' ? node.left : null;
    }
    return null;
}

function collectAssignments(ast: SrcNode): ImplicitGlobalAssignment[] | null {
    const candidates: Candidate[] = [];
    // Every scope root that has bound a name, and which names.
    const boundInRoot = new Map<SrcNode, Set<string>>();
    let hasWith = false;

    const stack: { node: SrcNode; roots: readonly SrcNode[] }[] = [{ node: ast, roots: [] }];
    while (stack.length > 0) {
        const frame = stack.pop() as { node: SrcNode; roots: readonly SrcNode[] };
        const { node, roots } = frame;
        // A function's own name and parameters bind in ITS scope, so a node that opens a
        // scope joins the chain before it is asked what it binds.
        const nodeRoots = isScopeRoot(node) ? [node, ...roots] : roots;

        if (node.type === 'WithStatement') hasWith = true;
        for (const name of bindingNames(node)) {
            // The NEAREST enclosing root — index 0, the chain is innermost-first — and only
            // that one. Marking every root up the chain would degrade this into a
            // module-wide "does any declaration anywhere mention the name" test, which loses
            // the rewrite for a module whose unrelated function takes such a parameter.
            const nearest = nodeRoots[0];
            if (!nearest) continue;
            addBinding(boundInRoot, nearest, name);
            if (hoistsOutward(node, name)) {
                const enclosing = nodeRoots[1];
                if (enclosing) addBinding(boundInRoot, enclosing, name);
            }
        }

        const target = freeTarget(node);
        if (target && target.name !== undefined && !NEVER_IMPLICIT_GLOBAL.has(target.name)) {
            candidates.push({ name: target.name, start: target.start, end: target.end, roots: nodeRoots });
        }

        for (const child of childrenOf(node)) stack.push({ node: child, roots: nodeRoots });
    }

    // A binding in scope for an assignment is declared in one of its ENCLOSING roots, so
    // walking the chain is what makes the rewrite safe — an undeclared name has none.
    // `with` is refused here rather than above: its answer is "no idea", not "rewrite".
    if (hasWith) return null;
    return candidates
        .filter(({ name, roots }) => !roots.some((root) => boundInRoot.get(root)?.has(name)))
        .map(({ name, start, end }) => ({ name, start, end }));
}

function addBinding(boundInRoot: Map<SrcNode, Set<string>>, root: SrcNode, name: string): void {
    const names = boundInRoot.get(root);
    if (names) {
        names.add(name);
        return;
    }
    boundInRoot.set(root, new Set([name]));
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
 * The free assignments in `code` (one entry per undeclared name written to), or `null` when
 * the module cannot be read — the whole module in the `with` case, since its bindings there
 * are dynamic.
 */
export function findImplicitGlobalAssignments(code: string, id: string): ImplicitGlobalAssignment[] | null {
    let ast: SrcNode;
    try {
        // Extension-aware (a `.ts` source arrives with its type syntax intact), and the
        // shared parser this package already parses source with — not a second copy.
        ast = parseSource(code, id) as unknown as SrcNode;
    } catch {
        return null;
    }
    return collectAssignments(ast);
}

/** `code` with every free assignment rewritten, or null when it needs none. */
export function rewriteImplicitGlobalAssignments(code: string, id: string): string | null {
    const edits = findImplicitGlobalAssignments(code, id);
    if (!edits || edits.length === 0) return null;
    // Descending, so each splice leaves the offsets of the ones after it valid. The name
    // from the AST rather than the source slice, so an escaped `\u0061ssignments` writes
    // the property it means.
    let out = code;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + GLOBAL_PREFIX + edit.name + out.slice(edit.end);
    }
    return out;
}

/**
 * Composed by ALL FOUR `--app` targets (ADR 0079's addendum) — for the measured reason in
 * the header: it is the fix on node and nativescript, and on gjs and browser it keeps the
 * `window` define from turning the assignment target into `globalThis = …`.
 */
export function implicitGlobalAssignPlugin(): Plugin {
    return {
        name: IMPLICIT_GLOBAL_ASSIGN_PLUGIN,
        transform: {
            filter: { id: REWRITE_FILTER },
            handler(code, id) {
                // Re-applied inside the handler, the way `react-native-gate.ts` does: the
                // object form is engine plumbing (under GJS `filter.id` is lifted into a
                // plugin-level `idFilter`), and a source rewrite must not depend on
                // plumbing to stay off `.css`, `.blp` and a data URL, none of which acorn
                // can read.
                if (!REWRITE_FILTER.test(id)) return null;
                const out = rewriteImplicitGlobalAssignments(code, id);
                return out === null ? null : { code: out, map: null };
            },
        },
    };
}
