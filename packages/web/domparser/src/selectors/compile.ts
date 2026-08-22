// AST in, one predicate out.
//
// Every compound compiles to a test that wraps everything to its LEFT as `next`
// and is evaluated at the RIGHTMOST element, so a match walks up a chain of
// parents instead of down a cross product of descendants. `div p span` visits
// each `span` once and asks two questions about its ancestors; the descendant
// scan it replaces asked every `div` about every `p` about every `span`.

import type { Adapter } from './adapter.js';
import { matchesNth } from './nth.js';
import type { Combinator, ComplexSelector, SimpleSelector } from './parse.js';

export interface MatchContext<TNode> {
    /** What `:scope` names, and the anchor a `:has()` measures against. */
    scope: TNode | null;
}

export type Predicate<TNode> = (node: TNode, ctx: MatchContext<TNode>) => boolean;

/**
 * Attributes whose VALUES the HTML spec compares case-insensitively regardless
 * of the `i` flag. Without them `[type=TEXT]` and `[rel=StyleSheet]` answer
 * differently here than in a browser, on markup nobody thinks of as unusual.
 *
 * https://html.spec.whatwg.org/multipage/semantics-other.html#case-sensitivity-of-selectors
 */
const HTML_CASE_INSENSITIVE_VALUES: ReadonlySet<string> = new Set([
    'accept',
    'accept-charset',
    'align',
    'alink',
    'axis',
    'bgcolor',
    'charset',
    'checked',
    'clear',
    'codetype',
    'color',
    'compact',
    'declare',
    'defer',
    'dir',
    'direction',
    'disabled',
    'enctype',
    'face',
    'frame',
    'hreflang',
    'http-equiv',
    'lang',
    'language',
    'link',
    'media',
    'method',
    'multiple',
    'nohref',
    'noresize',
    'noshade',
    'nowrap',
    'readonly',
    'rel',
    'rev',
    'rules',
    'scope',
    'scrolling',
    'selected',
    'shape',
    'target',
    'text',
    'type',
    'valign',
    'valuetype',
    'vlink',
]);

const WHITESPACE_RUN = /\s+/;

/**
 * Cheapest and most selective first. Both halves matter: `#id` rejects almost
 * everything for the cost of one map lookup, while `:has()` walks a subtree —
 * so a compound that fails on its id must never pay for the `:has()`.
 */
const COST: Record<SimpleSelector['kind'], number> = {
    universal: 0,
    attribute: 1,
    type: 2,
    nth: 3,
    empty: 3,
    root: 3,
    scope: 3,
    is: 4,
    not: 4,
    has: 5,
};

function cost(simple: SimpleSelector): number {
    if (simple.kind !== 'attribute') return COST[simple.kind];
    if (simple.name === 'id' && simple.action === 'equals') return 0;
    return simple.action === 'exists' ? 2 : 1;
}

function compileAttribute<TNode>(
    simple: Extract<SimpleSelector, { kind: 'attribute' }>,
    adapter: Adapter<TNode>,
): Predicate<TNode> {
    const name = adapter.caseSensitive ? simple.name : simple.name.toLowerCase();
    const fold =
        simple.ignoreCase === null
            ? !adapter.caseSensitive && HTML_CASE_INSENSITIVE_VALUES.has(name)
            : simple.ignoreCase;
    const value = fold ? simple.value.toLowerCase() : simple.value;
    const read = (node: TNode): string | null => {
        const raw = adapter.getAttributeValue(node, name);
        return raw === null || !fold ? raw : raw.toLowerCase();
    };
    const noMatch = () => false;

    switch (simple.action) {
        case 'exists':
            return (node) => adapter.getAttributeValue(node, name) !== null;
        case 'equals':
            return (node) => read(node) === value;
        // `[a!=v]` is satisfied by a MISSING attribute, and `[a!=]` by any
        // non-empty one — css-select's spelling of the operator it invented.
        case 'not':
            return value === '' ? (node) => (read(node) ?? '') !== '' : (node) => read(node) !== value;
        case 'start':
            return value === '' ? noMatch : (node) => read(node)?.startsWith(value) === true;
        case 'end':
            return value === '' ? noMatch : (node) => read(node)?.endsWith(value) === true;
        case 'any':
            return value === '' ? noMatch : (node) => read(node)?.includes(value) === true;
        case 'hyphen':
            return (node) => {
                const actual = read(node);
                return actual !== null && (actual === value || actual.startsWith(value + '-'));
            };
        default: {
            // `element`: a whitespace-separated list, which is what `.class` is.
            if (value === '' || WHITESPACE_RUN.test(value)) return noMatch;
            return (node) => read(node)?.split(WHITESPACE_RUN).includes(value) === true;
        }
    }
}

function compileNth<TNode>(
    simple: Extract<SimpleSelector, { kind: 'nth' }>,
    adapter: Adapter<TNode>,
): Predicate<TNode> {
    const fromEnd = simple.axis === 'last-child' || simple.axis === 'last-of-type';
    const byType = simple.axis === 'of-type' || simple.axis === 'last-of-type';
    const filter = simple.of === null ? null : compileList(simple.of, adapter);

    return (node, ctx) => {
        const siblings = adapter.getSiblings(node);
        const typeName = byType ? adapter.getName(node) : '';
        const step = fromEnd ? -1 : 1;
        let index = 0;
        for (let i = fromEnd ? siblings.length - 1 : 0; i >= 0 && i < siblings.length; i += step) {
            const sibling = siblings[i];
            if (!adapter.isTag(sibling)) continue;
            if (byType && adapter.getName(sibling) !== typeName) continue;
            // `of S` also decides whether the element itself COUNTS: one that
            // does not match S is never reached, so the selector cannot match it.
            if (filter !== null && !filter(sibling, ctx)) continue;
            index++;
            if (sibling === node) return matchesNth(simple.formula, index);
        }
        return false;
    };
}

function collectDescendants<TNode>(node: TNode, adapter: Adapter<TNode>, out: TNode[]): void {
    for (const child of adapter.getChildren(node)) {
        if (adapter.isTag(child)) out.push(child);
        collectDescendants(child, adapter, out);
    }
}

function followingSiblings<TNode>(node: TNode, adapter: Adapter<TNode>): TNode[] {
    const siblings = adapter.getSiblings(node);
    const start = siblings.indexOf(node);
    return start === -1 ? [] : siblings.slice(start + 1).filter((sibling) => adapter.isTag(sibling));
}

function compileHas<TNode>(
    simple: Extract<SimpleSelector, { kind: 'has' }>,
    adapter: Adapter<TNode>,
): Predicate<TNode> {
    const subs = simple.selectors.map((selector) => compileComplex(selector, adapter));
    const needsSiblings = simple.selectors.some((s) => s.leading === 'adjacent' || s.leading === 'sibling');
    // Memo, and it can never go stale: nothing hands a compiled predicate back
    // out, so this map lives exactly as long as the one query that built it.
    // `div:has(.x) span` asks the same `div` again for every `span` under it.
    const seen = new Map<TNode, boolean>();

    return (node, ctx) => {
        const remembered = seen.get(node);
        if (remembered !== undefined) return remembered;

        const candidates: TNode[] = [];
        collectDescendants(node, adapter, candidates);
        if (needsSiblings) for (const sibling of followingSiblings(node, adapter)) candidates.push(sibling);

        const outerScope = ctx.scope;
        ctx.scope = node;
        let found = false;
        for (const candidate of candidates) {
            if (subs.some((sub) => sub(candidate, ctx))) {
                found = true;
                break;
            }
        }
        ctx.scope = outerScope;
        seen.set(node, found);
        return found;
    };
}

function compileSimple<TNode>(simple: SimpleSelector, adapter: Adapter<TNode>): Predicate<TNode> {
    switch (simple.kind) {
        case 'universal':
            return () => true;
        case 'type': {
            const name = adapter.caseSensitive ? simple.name : simple.name.toLowerCase();
            return (node) => adapter.getName(node) === name;
        }
        case 'attribute':
            return compileAttribute(simple, adapter);
        case 'nth':
            return compileNth(simple, adapter);
        case 'empty':
            return (node) =>
                !adapter.getChildren(node).some((child) => adapter.isTag(child) || adapter.getText(child) !== '');
        case 'root':
            return (node) => {
                const parent = adapter.getParent(node);
                return parent === null || !adapter.isTag(parent);
            };
        case 'scope':
            return (node, ctx) => node === ctx.scope;
        case 'is':
            return compileList(simple.selectors, adapter);
        case 'not': {
            const inner = compileList(simple.selectors, adapter);
            return (node, ctx) => !inner(node, ctx);
        }
        default:
            return compileHas(simple, adapter);
    }
}

function compileCompound<TNode>(simples: SimpleSelector[], adapter: Adapter<TNode>): Predicate<TNode> {
    const tests = simples
        .slice()
        .sort((a, b) => cost(a) - cost(b))
        .map((simple) => compileSimple(simple, adapter));
    if (tests.length === 1) return tests[0];
    return (node, ctx) => {
        for (const test of tests) if (!test(node, ctx)) return false;
        return true;
    };
}

function compileCombinator<TNode>(
    combinator: Combinator,
    left: Predicate<TNode>,
    adapter: Adapter<TNode>,
): Predicate<TNode> {
    switch (combinator) {
        // Neither of these two requires the parent to be an ELEMENT. A document
        // is a legal left-hand side once `:scope` can name it — `:scope > html`
        // matches from a document — and a type or attribute test asked about a
        // document simply answers no, so nothing else changes.
        case 'child':
            return (node, ctx) => {
                const parent = adapter.getParent(node);
                return parent !== null && left(parent, ctx);
            };
        case 'descendant':
            return (node, ctx) => {
                let parent = adapter.getParent(node);
                while (parent !== null) {
                    if (left(parent, ctx)) return true;
                    parent = adapter.getParent(parent);
                }
                return false;
            };
        case 'adjacent':
            return (node, ctx) => {
                const siblings = adapter.getSiblings(node);
                for (let i = siblings.indexOf(node) - 1; i >= 0; i--) {
                    if (adapter.isTag(siblings[i])) return left(siblings[i], ctx);
                }
                return false;
            };
        default:
            return (node, ctx) => {
                const siblings = adapter.getSiblings(node);
                for (let i = siblings.indexOf(node) - 1; i >= 0; i--) {
                    if (adapter.isTag(siblings[i]) && left(siblings[i], ctx)) return true;
                }
                return false;
            };
    }
}

export function compileComplex<TNode>(selector: ComplexSelector, adapter: Adapter<TNode>): Predicate<TNode> {
    // A relative selector is anchored on `:scope`, so `:has(> .price)` compiles
    // to exactly what `:scope > .price` compiles to.
    let next: Predicate<TNode> =
        selector.leading === null
            ? () => true
            : compileCombinator(selector.leading, (node, ctx) => node === ctx.scope, adapter);

    for (let i = 0; i < selector.compounds.length; i++) {
        if (i > 0) next = compileCombinator(selector.combinators[i - 1], next, adapter);
        const compound = compileCompound(selector.compounds[i], adapter);
        const left = next;
        next = (node, ctx) => compound(node, ctx) && left(node, ctx);
    }
    return next;
}

export function compileList<TNode>(selectors: ComplexSelector[], adapter: Adapter<TNode>): Predicate<TNode> {
    const compiled = selectors.map((selector) => compileComplex(selector, adapter));
    if (compiled.length === 1) return compiled[0];
    return (node, ctx) => compiled.some((predicate) => predicate(node, ctx));
}
