// WHAT A JSX EXPRESSION EVALUATES TO — the one claim no other fixture made.
//
// Every other positive here asserts what may go IN (tags, props, handlers, refs).
// None asserted what comes OUT, and the gap was not free: `JSX.Element` was
// declared as `ElementChild` — the type of what may be PASSED as a child, which
// includes `undefined`, `string` and arrays — rather than as `HostNode`, which is
// what the compiler's `createElement` returns.
//
// Nothing in this directory could see it, because a surface is only as checked as
// the programs written against it, and no fixture handed a JSX element to
// something that wanted a node. The consequence was that the adapter's control
// flow was untypeable: `<For>`, `<Index>` and `<Show>` are typed against
// `HostNode` (Solid's own signatures pin `JSX.Element` to the DOM's `Element`, so
// the adapter re-types them), and the FIRST `<For>` in any application failed with
// `Type 'ElementChild' is not assignable to type 'HostNode'`. The first real JSX
// app found it — `showcases/gtk/solid-host-counter`, whose `check` script runs in
// CI via `check:examples`.
//
// The type is imported RELATIVELY on purpose. Routing it through the package's own
// bare specifier would need a `paths` entry for `.`, which resolves to `index.ts`
// and pulls the whole runtime into this program — measured: five pre-existing
// `string | null` errors in `host.ts`/`props.ts`, which compile under the package's
// own `strict: false` and not under the four settings this gate pins. That is a
// real finding about `gtk-host`, and it is not this fixture's claim.

import type { HostElement, HostNode } from '../../src/types.js';

declare function insertInto(child: HostNode, parent: HostElement): void;

/** A JSX element IS a host node — the assertion is that this line compiles. */
export const element: HostNode = <gtk-label label="a label" />;

/** …including in the argument position the control-flow components use. */
declare const box: HostElement;
insertInto(<gtk-button iconName="list-add-symbolic" />, box);

/** A nested expression is a node too, not a union with `undefined`. */
export const nested: HostNode = (
    <gtk-box orientation="vertical">
        <gtk-label label="child" />
    </gtk-box>
);
