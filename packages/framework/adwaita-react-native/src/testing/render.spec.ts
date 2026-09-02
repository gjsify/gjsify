// The React Native spec harness — what every `*.native.spec.tsx` needs before it can read
// a tree.
//
// NAMED `*.spec.ts` AND EXPORTING NO SUITE, for the reason `gtk.spec.tsx` gives: the
// suffix keeps it out of the shipped library while `check-node-test-registration.mjs`
// still holds it reachable, which is what `packages/node/fs/src/capabilities.spec.ts` is
// for six siblings.
//
// `IS_REACT_ACT_ENVIRONMENT` IS SET HERE, ONCE. It is React's own opt-in for a test
// environment, and without it every `act()` prints "The current testing environment is
// not configured to support act(...)" and React declines to own the flush — the
// assertions happened to pass anyway, which is the worst version of this: a warning
// nobody reads standing between the suite and a guarantee it thinks it has. Setting it in
// each spec was seven chances to forget.
//
// `act()` IS WHAT MOUNTS A REACT 19 TEST RENDERER AT ALL — `create(element).toJSON()`
// without it returns `null`, measured — which is also why this package's Node test bundle
// is built WITHOUT `--define 'process.env.NODE_ENV="production"'`: `act` does not exist in
// React's production build, and `react-test-renderer.production.js` re-exports the
// `undefined` it got, so `import { act }` type-checks and is `undefined` at call time.
// The full measurement is in `../widgets/clamp.native.spec.tsx`.

import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A host node's style, as the widget asked for it. */
export type Style = Record<string, unknown> | undefined;

/**
 * Mount and keep the RENDERER, for a suite that has to drive a state transition.
 *
 * ONE renderer, read twice. Creating a second one for the post-transition read hands back
 * a pre-transition snapshot — the state lives in the first — and the suite then asserts
 * the untouched tree while claiming to assert the settled one.
 */
export function mount(element: React.ReactElement): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(element);
    });
    return renderer;
}

/** Mount and read the tree. */
export const mounted = (element: React.ReactElement): ReactTestRendererJSON =>
    mount(element).toJSON() as ReactTestRendererJSON;

/** A node's element children, with text children refused rather than silently skipped. */
export function childrenOf(node: ReactTestRendererJSON): ReactTestRendererJSON[] {
    const children = node.children ?? [];
    for (const child of children) {
        if (typeof child === 'string') throw new Error(`unexpected text child ${JSON.stringify(child)}`);
    }
    return children as ReactTestRendererJSON[];
}

/**
 * The child at `index`, or a failure naming the count.
 *
 * An index into a `ReactTestRendererJSON[]` is `| undefined`, and the two ways out of
 * that in an assertion are both worse than a throw: `?.` turns a missing node into a
 * comparison against `undefined` that some matcher will accept, and a cast asserts the
 * thing the test was supposed to check.
 */
export function at(nodes: ReactTestRendererJSON[], index: number): ReactTestRendererJSON {
    const node = nodes[index];
    if (node === undefined) throw new Error(`no child at index ${index}; there are ${nodes.length}`);
    return node;
}

/** The one element child, or a failure naming what was there instead. */
export function onlyChild(node: ReactTestRendererJSON): ReactTestRendererJSON {
    const children = node.children ?? [];
    if (children.length !== 1 || typeof children[0] === 'string') {
        throw new Error(`expected exactly one element child, got ${JSON.stringify(children)}`);
    }
    return children[0] as ReactTestRendererJSON;
}

/** The text a `Text` node holds, joined — `toJSON` reports it as a child array. */
export function textOf(node: ReactTestRendererJSON): string {
    return (node.children ?? [])
        .map((child) => (typeof child === 'string' ? child : `<${String(child.type)}>`))
        .join('');
}
