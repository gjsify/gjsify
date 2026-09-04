// What a parent asks about its children — and everything that must not hide the answer.
//
// THE ONE PLACE THE QUESTION IS ASKED, and it needs to be one place because it is
// asked TWICE about the same tree: `usePlan` counts the absolutely positioned children
// to decide whether a `View` becomes a `Gtk.Overlay`, and `render` filters the same
// children to fill that overlay's `add_overlay` slot. A count and a placement that
// disagree build an overlay with nothing in it, or a box holding a child GTK will
// position against the wrong widget.
//
// WHY REACT NEEDS THIS FILE AND SOLID DOES NOT. The two L3s build a tree in opposite
// directions (`solid/index.ts` writes the pair out): Solid's children exist BEFORE
// their parent, so each one stamps ITSELF from its own plan — `SLOTTED`, a `WeakSet`
// of nodes that resolved to an overlay slot, and nothing guesses. React's parent
// renders FIRST and has only descriptors, so it has to read somebody else's props and
// answer a question about them. That asymmetry is where the whole defect class lives:
// a descriptor this reader cannot interpret used to answer "no", and "no" is a
// perfectly plausible answer that nothing anywhere reports.
//
// THE CLASS, AND WHY THE FIX IS TWO TRANSPARENCIES AND NOT TWO SPECIAL CASES (#1451).
// Two shapes an application writes every day were unreadable, for two unrelated
// reasons, and both came back as "not absolute":
//
//   <>…</>                      a Fragment answers for ITSELF. Its props are
//                               `{ children }` — no `style`, no `className` — so a
//                               parent read no `absolute` on it and none on the child
//                               it hides. `Children.toArray` does NOT descend into
//                               one (measured: react 19, a Fragment survives as an
//                               element whose type is `Symbol(react.fragment)`).
//   <Animated.View style={{      an `Animated.Value` in a style is exactly what L2
//     opacity: value }}          refuses on a plain element, so asking L2 to read the
//     className="absolute" />    raw props THREW — and the `catch` below turned the
//                               throw into `false`.
//
// A Fragment is transparent to layout in React, so it is made transparent here:
// `childNodes` expands it away before anything counts. An `Animated.View` is a `View`
// whose style carries values L2 reads through `splitAnimatedStyle` — so the parent's
// read uses the same split the element itself does. Neither is a rule about `absolute`:
// the same two blindnesses hid `text` (a text run inside a Fragment, which competes
// with a prop for a widget's text sink) and `count` — which nothing reads yet, and is
// the fact `justify-between`'s refusal names as the one it does not have, so it was
// wrong before any reader could exist. `child-facts.spec.ts` holds every fact this
// record carries against every wrapper shape rather than the one that was reported.
//
// WHAT THE `catch` IS STILL FOR, and it is not defensive padding: a parent asking
// about a FOREIGN composite child — `<MyCard className="card-lg">`, a component that
// never reaches L2 — must not throw for a vocabulary that is not this layer's. What is
// no longer allowed is a shape THIS package can render coming back unreadable, and that
// is the boundary the spec enumerates.
//
// AND IT CANNOT HIDE A DEFECT, which is a property of the read rather than a promise:
// the parent's read is a SUBSET of the child's own resolution — the same `normalise`
// over the same `className`/`style`, with the child's prop routes added on top — so
// every throw swallowed here is raised again, naming the child's own token, when that
// child resolves itself. The spec holds both halves against two shapes this package
// renders; without that pair, "the parent answered no" stays green whether the `catch`
// has a throw path or none at all.

import { Children, cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { StyleTokens } from '@gjsify/gtk-host/style';

import { declaresAbsolute, type ChildFacts, type PrimitiveProps } from './primitives/resolve.js';
import { splitAnimatedStyle, type StyleInput } from './primitives/style.js';

/** A text run, which is a child a widget's text sink has to answer for. */
export const isTextNode = (child: ReactNode): boolean => typeof child === 'string' || typeof child === 'number';

const isFragment = (node: ReactNode): node is ReactElement<{ readonly children?: ReactNode }> =>
    isValidElement(node) && node.type === Fragment;

/**
 * `props.children` → the children a parent actually has, Fragments expanded away.
 *
 * `Children.toArray` first, for what it does do: it drops `null`, `undefined` and
 * booleans (a `{cond && <Row/>}` that short-circuited is not a child) and gives every
 * survivor a key. What it does not do is descend into a Fragment, so that half is here.
 *
 * KEYS ARE COMPOSED, NEVER REASSIGNED. An expanded child keeps its own key behind its
 * Fragment's — `.$group` + `:` + `.$badge` — so a re-render derives the same key from
 * the same tree. Dropping the keys instead would make every update look like a reorder
 * to React, and remount the subtree.
 *
 * The array is rebuilt only when there IS a Fragment to expand: this runs for every
 * element in the tree on every render, and the common case has to cost a scan.
 */
export function childNodes(children: ReactNode): readonly ReactNode[] {
    return expand(Children.toArray(children));
}

/**
 * What separates a Fragment's key from its child's, and why composing needs one.
 *
 * MEASURED, react 19: `Children.toArray` ESCAPES a colon in an authored key (`a:b`
 * becomes `.$a=2b`, and `=` becomes `=0`), gives an unkeyed child `.<index base 36>`,
 * and touches neither `.` nor `/`. So a colon cannot occur inside any key it produces,
 * and the one below is the only one in a composed key — which is what makes the
 * composition INJECTIVE and two different authored trees unable to land on one key.
 *
 * Concatenating the halves directly is not injective, and the collision is ordinary
 * authoring rather than an adversarial spelling: `<Fragment key="row">` around an
 * unkeyed child produced `.$row.0`, and so did a plain sibling authored `key="row.0"` —
 * the composite key a `.map()` over grouped data writes. React answers a duplicate key
 * by matching those two children POSITIONALLY (measured: they swap content and keep
 * each other's widgets on a reorder), so a `TextInput`'s cursor, a scroll position or
 * an `Animated.Value` binding follows the wrong element — and React's own
 * duplicate-key warning goes to a console a GJS process does not have.
 */
const KEY_SEPARATOR = ':';

function expand(nodes: readonly ReactNode[]): readonly ReactNode[] {
    if (!nodes.some(isFragment)) return nodes;
    const out: ReactNode[] = [];
    for (const node of nodes) {
        if (!isFragment(node)) {
            out.push(node);
            continue;
        }
        const prefix = node.key ?? '';
        for (const inner of expand(Children.toArray(node.props.children))) {
            // A text run has no key to compose and needs none: `Children.toArray` keeps
            // its position, and only elements carry an identity React reconciles by.
            if (!isValidElement(inner)) {
                out.push(inner);
                continue;
            }
            out.push(cloneElement(inner, { key: `${prefix}${KEY_SEPARATOR}${inner.key ?? ''}` }));
        }
    }
    return out;
}

/**
 * A child element's props, in the spelling L2 can read.
 *
 * The ONE transformation this package's own components make to a style before L2 sees
 * it: `Animated.View` takes the animated entries out (`components.ts`' binding pass
 * does the same split for the other half). A parent reading the raw props would hand
 * L2 a value it refuses by design and get a throw instead of an answer.
 */
export function readableProps(element: ReactElement): PrimitiveProps {
    const props = element.props as PrimitiveProps;
    if (props.style === undefined) return props;
    const { plain, animated } = splitAnimatedStyle(props.style as StyleInput);
    return Object.keys(animated).length === 0 ? props : { ...props, style: plain };
}

/**
 * Does this child declare `position: absolute`?
 *
 * The predicate is L2's, so the COUNT the parent takes here and the PLACEMENT it makes
 * later cannot disagree — and it runs the real resolution rather than testing for the
 * literal string `absolute`, because the syntactic test is exact only while L1's
 * vocabulary has one spelling for it. It has two today (`absolute`, and
 * `style={{ position: 'absolute' }}`) and nothing stops it having three.
 *
 * The `catch` is for a FOREIGN child only — the header says why, and why that is no
 * longer where this package's own shapes end up.
 */
export function isAbsoluteChild(child: ReactNode, tokens: StyleTokens): boolean {
    if (!isValidElement(child)) return false;
    try {
        return declaresAbsolute(readableProps(child), tokens);
    } catch {
        return false;
    }
}

/** The children a parent has → the facts L2 asks about them. */
export function childFacts(children: readonly ReactNode[], tokens: StyleTokens): ChildFacts {
    let absolute = 0;
    let text = false;
    for (const child of children) {
        if (isTextNode(child)) text = true;
        else if (isAbsoluteChild(child, tokens)) absolute++;
    }
    return { absolute, count: children.length, text };
}
