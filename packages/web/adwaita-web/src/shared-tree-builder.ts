// THE INSTANTIATION HALF OF ADR 0051, SHIPPED — the `adwaita-web` third of what #1726 did
// for `gtk-host` and #1729 did for `adwaita-nativescript`. Turning an
// `@gjsify/adwaita-core/conformance` `SharedTreeNode` into real `<adw-*>`/`<gtk-*>` custom
// elements is this renderer's OWN translation, not test code, and it lived only inside
// `shared-trees.spec.ts` — unreachable by a storybook fixture, a devtools probe replaying a
// gallery block, or a second suite, all of which would have had to import a `.spec.ts` file
// to reach it. `hostTagOf`/`attributeOf` moved to `@gjsify/adwaita-core/tags` for exactly
// this: a builder shipping FROM a package, not a dev-only driver reading `scripts/`, can
// depend on the two case rules without depending on `scripts/`, which cannot ship inside an
// npm package at all.
//
// TWO FUNCTIONS, NOT ONE WITH A FLAG — the split neither sibling builder needed.
// `gtk-host`'s `materialize`/`insert` and NativeScript's `_addChildFromBuilder` each fully
// REALISE a widget at construction; nothing later changes what it is. A Custom Element is
// not: most elements this package defines build their internals in `connectedCallback`
// (`shared-trees.spec.ts`'s own note: "these elements build on connect"), which runs only
// once the element is CONNECTED to a document. So `buildSharedTree` alone — `createElement`
// + `setAttribute`, recursing into children — is precisely the builder that ships dead
// nodes: it stays exported for a caller supplying its own attachment point (its result
// becomes live the moment ANYTHING connects it, same as a bare `document.createElement`
// always has), but the complete path most callers want is `mountSharedTree`: build, attach
// under a fresh host `<div>` in `document.body`, hand back the realised root.
//
// `unmount` IS PART OF THE SAME LIFECYCLE, NOT A TEST HOOK. `shared-trees.spec.ts`'s own
// `finally` block is test POLICY (never leave a red test's tree mounted for the next one to
// trip over); the ability to detach what was attached is a plain fact about anything with a
// `connectedCallback`, so `mountSharedTree` hands it back rather than making a caller reach
// into a host `<div>` it was never given.
//
// Placed flat under `src/`, at parity with this package's other single-purpose modules
// (`accent.ts`, `breakpoints.ts`, `icon-registry.ts`) rather than a new `conformance/` or
// `builder/` directory for one file: unlike `gtk-host`, this package has no existing
// `conformance/` home to add to. Exported through the existing barrel, `src/index.ts` — the
// package's `exports` map ships only `.`, and a new subpath would buy nothing for a module
// this small, most of which (the `SharedTreeNode` type) is erased at build anyway.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { attributeOf, hostTagOf } from '@gjsify/adwaita-core/tags';

/**
 * A `SharedTreeNode`, realised as a DETACHED element tree: a tag, its authored properties as
 * attributes, its children, in that order — recursive and total, no tag list, no per-block
 * case. A boolean authored property is the ATTRIBUTE'S PRESENCE (`toggleAttribute`), which is
 * what every element in the corpus reads (`hasAttribute('revealed')`, `hasAttribute('expanded')`);
 * spelling `"true"` would set a present attribute for `false` as well.
 *
 * NOT YET LIVE — see the file header. Nothing here has run `connectedCallback` until
 * something connects it: {@link mountSharedTree} for the common case, or a caller's own
 * container.
 */
export function buildSharedTree(node: SharedTreeNode): HTMLElement {
    const el = document.createElement(hostTagOf(node.tag));
    for (const [prop, value] of Object.entries(node.props ?? {})) {
        if (typeof value === 'boolean') el.toggleAttribute(attributeOf(prop), value);
        else el.setAttribute(attributeOf(prop), String(value));
    }
    for (const child of node.children ?? []) el.append(buildSharedTree(child));
    return el;
}

/** A tree {@link mountSharedTree} built and connected. */
export interface MountedSharedTree {
    /** The authored root — connected, so every custom element under it has upgraded and run. */
    root: HTMLElement;
    /** Disconnects and discards the mount point. */
    unmount: () => void;
}

/**
 * {@link buildSharedTree}, attached under a fresh host `<div>` in `document.body` so the tree
 * — and every custom element in it — is REAL rather than merely constructed. This is the
 * instantiation half a caller reading the corpus's elements normally wants; a bare
 * `buildSharedTree` is for a caller that already has somewhere of its own to attach it.
 */
export function mountSharedTree(node: SharedTreeNode): MountedSharedTree {
    const host = document.createElement('div');
    host.append(buildSharedTree(node));
    document.body.append(host);
    return { root: host.firstElementChild as HTMLElement, unmount: () => host.remove() };
}
