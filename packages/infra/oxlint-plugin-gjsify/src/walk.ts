// Shared subtree walker for the class-scoped rules.
//
// oxlint's JS-plugin visitor dispatches per node TYPE, which is enough for a rule that only
// inspects a class's DIRECT children (`register-class-order`). A rule that asks "does this class
// build widgets anywhere inside it" needs the whole subtree, and `Node.parent` is not something
// the plugin host guarantees to populate — so the traversal is owned here rather than inferred
// from a parent chain that may not exist.

import type { Node } from './types.ts';

/** True for a plain object that carries the shape of an AST node. */
function isNode(value: unknown): value is Node {
    return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * Depth-first walk over every node in `root`'s subtree, `root` included.
 *
 * THREE keys are skipped, for two different reasons. `parent`, because where the host populates it,
 * following it walks back out of the subtree and loops forever. `tokens` and `comments`, because
 * oxlint hangs both off the Program node and `isNode` is a STRUCTURAL sniff — a token object has a
 * `type` string, so it looks exactly like a node. Measured: walking them accounted for the large
 * majority of these rules' wall-clock and visited nothing either rule can act on.
 *
 * That structural sniff is the general hazard: anything with a string `type` is followed. Hand this
 * function the smallest root that contains what you need, not the Program node.
 */
export function walk(root: Node, visit: (node: Node) => void): void {
    visit(root);
    for (const key of Object.keys(root)) {
        if (key === 'parent' || key === 'tokens' || key === 'comments') continue;
        const value = root[key];
        if (Array.isArray(value)) {
            for (const item of value) if (isNode(item)) walk(item, visit);
        } else if (isNode(value)) {
            walk(value, visit);
        }
    }
}

/** `new Gtk.Label(…)` / `new Adw.ActionRow(…)` → `"Gtk.Label"` / `"Adw.ActionRow"`; else null. */
export function newGtkAdwType(node: Node): string | null {
    if (node.type !== 'NewExpression') return null;
    const callee = node.callee as Node | undefined;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed === true) return null;
    const object = callee.object as Node | undefined;
    const property = callee.property as Node | undefined;
    if (object?.type !== 'Identifier' || property?.type !== 'Identifier') return null;
    const ns = object.name as string;
    if (ns !== 'Gtk' && ns !== 'Adw') return null;
    return `${ns}.${property.name as string}`;
}

/** The method name of `x.foo(…)`, or null for anything that is not a plain member call. */
export function memberCallName(node: Node): string | null {
    if (node.type !== 'CallExpression') return null;
    const callee = node.callee as Node | undefined;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed === true) return null;
    const property = callee.property as Node | undefined;
    if (property?.type !== 'Identifier') return null;
    return property.name as string;
}
