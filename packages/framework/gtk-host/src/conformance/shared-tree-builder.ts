// The instantiation half of ADR 0051: one authored tree, three renderers.
//
// `@gjsify/adwaita-core/conformance`'s `SharedTreeNode` is renderer-free — a tag, its
// authored properties, its children, nothing more. Turning one into real widgets is each
// renderer's OWN translation, and this package's half of it is four lines over
// `createElement`/`insert`/`materialize` — all `./host.js` operations every adapter in this
// package already calls. It ships from `conformance/` rather than living inside the one spec
// that used to be its only caller (`../shared-trees.spec.ts`) because that translation is not
// test-specific: a consumer wanting to hand an authored tree to `gtk-host` directly — a second
// suite, a storybook fixture, a devtools probe replaying a gallery block — had no route to it
// that did not mean importing a `.spec.ts` file, which this repo's Testing convention (root
// AGENTS.md) reserves for what a test RUNNER executes, not for code another module depends on.
//
// PRECONDITION: `registerBuiltinWidgets()` (`../descriptors/index.js`) must already have run.
// `buildSharedTree` does not call it — `createElement` resolves `node.tag` through the same
// registry every other caller in this package uses, and registering it here would hide a
// caller who forgot to register anything ELSE materialisation needs. The CALLER owns it,
// exactly as every `*.spec.ts` in this package already does before touching `createElement`.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { createElement, insert, materialize } from '../host.js';
import type { HostElement } from '../types.js';

/**
 * A `SharedTreeNode`, realised: a tag, its authored properties, its children, in that order.
 *
 * Recursive and total — no tag list, no property list, no per-block case. The authored
 * property NAMES go to `setProp` verbatim (through `createElement`), which is the point:
 * `buttonLabel` reaching `button-label` is the host's own coercion, and a caller spelling the
 * GObject name itself would be testing its own translation table instead of this one's.
 */
export function buildSharedTree(node: SharedTreeNode): HostElement {
    const el = createElement(node.tag, node.props as Record<string, unknown> | undefined);
    // Before the children: `insert` parents a REALISED widget, and a construct-only
    // property that never arrives reaches `g_error()` rather than failing cleanly.
    materialize(el);
    for (const child of node.children ?? []) insert(buildSharedTree(child), el);
    return el;
}
