// The four entry points a DOM puts its selector methods on.
//
// Each one parses and compiles from scratch. That is deliberate: a compiled
// predicate carries a `:has()` memo, and a memo that outlives the query outlives
// the tree it measured. Parsing a selector is string work over a few dozen
// characters; re-walking a stale answer is a wrong result.

import type { Adapter } from './adapter.js';
import { compileList, type MatchContext, type Predicate } from './compile.js';
import { parseSelectorList } from './parse.js';

function compile<TNode>(selector: string, adapter: Adapter<TNode>): Predicate<TNode> {
    return compileList(parseSelectorList(selector), adapter);
}

/** Pre-order over the descendants of `root` — document order, root excluded. */
function walk<TNode>(root: TNode, adapter: Adapter<TNode>, visit: (node: TNode) => boolean): boolean {
    for (const child of adapter.getChildren(root)) {
        if (adapter.isTag(child) && visit(child)) return true;
        if (walk(child, adapter, visit)) return true;
    }
    return false;
}

/** Every descendant of `root` matching `selector`, in document order. */
export function selectAll<TNode>(selector: string, root: TNode, adapter: Adapter<TNode>): TNode[] {
    const predicate = compile(selector, adapter);
    const ctx: MatchContext<TNode> = { scope: root };
    const found: TNode[] = [];
    walk(root, adapter, (node) => {
        if (predicate(node, ctx)) found.push(node);
        return false;
    });
    return found;
}

export function selectOne<TNode>(selector: string, root: TNode, adapter: Adapter<TNode>): TNode | null {
    const predicate = compile(selector, adapter);
    const ctx: MatchContext<TNode> = { scope: root };
    let first: TNode | null = null;
    walk(root, adapter, (node) => {
        if (!predicate(node, ctx)) return false;
        first = node;
        return true;
    });
    return first;
}

/** `:scope` is the element being tested, as `Element.matches()` defines it. */
export function matchesSelector<TNode>(selector: string, node: TNode, adapter: Adapter<TNode>): boolean {
    return compile(selector, adapter)(node, { scope: node });
}

/** `node` itself first, then its ancestors — `Element.closest()`. */
export function closestSelector<TNode>(selector: string, node: TNode, adapter: Adapter<TNode>): TNode | null {
    const predicate = compile(selector, adapter);
    const ctx: MatchContext<TNode> = { scope: node };
    let current: TNode | null = node;
    while (current !== null && adapter.isTag(current)) {
        if (predicate(current, ctx)) return current;
        current = adapter.getParent(current);
    }
    return null;
}
