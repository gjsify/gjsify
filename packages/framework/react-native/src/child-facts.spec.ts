// Every fact a parent reads off its children, against every wrapper it can arrive in.
//
// THE MECHANISM, NOT THE CASE. #1451 reported ONE shape — an absolutely positioned
// child wrapped in a `<>…</>` — and a second one was measured beside it in a consumer
// (an `<Animated.View className="absolute" style={{ opacity: value }}>`, which is the
// same defect through an unrelated door). The two share a class: a parent reading
// somebody else's descriptor answers a question it cannot always answer, and "cannot
// tell" was spelled the same way as "no". So this file does not test the two shapes.
// It enumerates the CROSS PRODUCT of
//
//   every fact `childFacts` produces  ×  every way an application can wrap a child
//
// and the coverage case below derives the fact list from the RECORD ITSELF, so a
// fourth field added to `ChildFacts` fails here until it has a row. That is the half
// that keeps this a mechanism: the wrapper list is a judgement about authoring, but
// nobody has to remember to extend it when the facts grow.
//
// EVERY FACT IS DISCRIMINATED, and without that this whole file is worthless: a reader
// answering `true` to everything would pass the positive matrix completely. So a FLAG
// fact also declares a child that does NOT carry it, asserted through the same
// wrappers — `absolute` must be 0 for a `mt-2` child inside a Fragment and `text` must
// stay false for an element child. `count` needs no negative case because its assertion
// is an equality against a number two wrappers in the table disagree about.
//
// PURE DATA, SO IT RUNS EVERYWHERE. Nothing here mounts anything: `childFacts` is the
// parent's question and its answer is a record. The claim that the answer then builds
// a real `Gtk.Overlay` with the child in its `add_overlay` slot is
// `primitives/widgets.spec.ts`' business, and the claim that React and Solid agree
// about a transparent wrapper is `solid/solid.spec.ts`' — both read real widget trees.

import { describe, expect, it } from '@gjsify/unit';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';
import { createElement, Fragment, type ReactNode } from 'react';

import { childFacts, childNodes } from './child-facts.js';
import { AnimatedValue } from './animated/value.js';
// `AnimatedView` is the exported name; `Animated.View` is what an application writes.
import { AnimatedView, Text, View } from './components.js';
import type { ChildFacts } from './primitives/resolve.js';

const TOKENS: StyleTokens = { ...MINIMAL_TOKENS, spacing: { ...MINIMAL_TOKENS.spacing, '2': '8px' } };

/** The parent's answer for one authored `children` value. */
const factsOf = (children: ReactNode): ChildFacts => childFacts(childNodes(children), TOKENS);

/**
 * One way an application wraps a child without meaning to change anything about it.
 *
 * `count` is what the wrapper contributes to `ChildFacts.count` — the number of REAL
 * children behind it. A Fragment contributes its contents, never itself, which is what
 * makes it transparent. Nothing in L2 reads `count` today; it is asserted anyway
 * because it was WRONG through a Fragment before any reader could exist, and because
 * L2 is entitled to assume its inputs are coherent (`solid/index.ts` says so from the
 * other side: `absolute: 1, count: 0` is not a state any tree can be in).
 */
interface Wrapper {
    readonly name: string;
    readonly wrap: (child: ReactNode) => ReactNode;
    readonly count: number;
}

const WRAPPERS: readonly Wrapper[] = [
    { name: 'authored directly', wrap: (child) => child, count: 1 },
    { name: 'a Fragment', wrap: (child) => createElement(Fragment, null, child), count: 1 },
    // A keyed Fragment is what a `.map()` emits, and its key is what the expanded
    // child's key is composed behind.
    { name: 'a keyed Fragment', wrap: (child) => createElement(Fragment, { key: 'group' }, child), count: 1 },
    {
        name: 'two nested Fragments',
        wrap: (child) => createElement(Fragment, null, createElement(Fragment, null, child)),
        count: 1,
    },
    {
        name: 'a Fragment holding a sibling too',
        wrap: (child) => createElement(Fragment, null, createElement(View, { key: 'sibling' }), child),
        count: 2,
    },
    // An array is what `Children.toArray` already flattened before this defect
    // existed, and it is in the table as the control that says so.
    { name: 'an array', wrap: (child) => [child], count: 1 },
    {
        name: 'a Fragment inside an array',
        wrap: (child) => [createElement(Fragment, { key: 'g' }, child)],
        count: 1,
    },
];

/** A child that carries a fact, authored the way an application authors it. */
interface Carrier {
    readonly name: string;
    readonly node: ReactNode;
}

/** One child-answered fact, the children that carry it, and the child that does not. */
interface Fact {
    readonly key: keyof ChildFacts;
    readonly carriers: readonly Carrier[];
    /** Is the fact intact, given the wrapper it arrived through? */
    readonly intact: (facts: ChildFacts, wrapper: Wrapper) => boolean;
    /**
     * The discriminator: a child WITHOUT the fact, which must not report it.
     *
     * Absent only where the positive assertion is already discriminating — `count` is
     * an equality against a number two wrappers in the table disagree about, so a
     * reader that always said yes fails it. A FLAG fact has no such property, and one
     * without a negative case here is a green check that checks nothing.
     */
    readonly absent?: Carrier;
    readonly quiet?: (facts: ChildFacts) => boolean;
}

/**
 * `Animated.View`'s carriers, and why they are here rather than in `animated.spec.ts`.
 *
 * `Animated.View` is not a row in the primitive table — it resolves AS a `View` and
 * takes the animated entries out of its style first (`components.ts`). That made its
 * descriptor unreadable to a parent: an `Animated.Value` in a style is exactly what L2
 * refuses on a plain element, so asking L2 to read the raw props threw, and the throw
 * was swallowed as "not absolute". MEASURED in a consumer (the CORRECTIV desktop app,
 * a 160 ms header cross-fade): swapping a plain `<View className="absolute …">` for an
 * `<Animated.View>` was the only change needed to lose the overlay.
 */
const animatedCarriers = (): readonly Carrier[] => [
    {
        name: 'an Animated.View with an absolute className',
        node: createElement(AnimatedView, {
            className: 'absolute',
            style: { opacity: new AnimatedValue(0) },
        }),
    },
    {
        name: 'an Animated.View with position in its style',
        node: createElement(AnimatedView, {
            style: [{ position: 'absolute' }, { opacity: new AnimatedValue(1) }],
        }),
    },
];

const FACTS: readonly Fact[] = [
    {
        key: 'absolute',
        carriers: [
            { name: 'a View with an absolute className', node: createElement(View, { className: 'absolute' }) },
            {
                name: 'a Text with position in its style',
                node: createElement(Text, { style: { position: 'absolute' } }, 'badge'),
            },
            ...animatedCarriers(),
        ],
        intact: (facts) => facts.absolute === 1,
        absent: { name: 'a View with an ordinary margin', node: createElement(View, { className: 'mt-2' }) },
        quiet: (facts) => facts.absolute === 0,
    },
    {
        key: 'text',
        carriers: [
            { name: 'a string', node: 'hello' },
            { name: 'a number', node: 41 },
        ],
        intact: (facts) => facts.text,
        absent: { name: 'an element', node: createElement(View, null) },
        quiet: (facts) => !facts.text,
    },
    {
        key: 'count',
        // `count`'s carrier is any child at all, and its assertion is an EQUALITY
        // rather than a flag — so the wrappers disagreeing about the number are its
        // discriminator, and it declares no negative case.
        carriers: [{ name: 'a plain View', node: createElement(View, null) }],
        intact: (facts, wrapper) => facts.count === wrapper.count,
    },
];

export default async () => {
    await describe('a wrapper is transparent to the facts a parent reads (#1451)', async () => {
        await it('covers every fact the parent actually produces — a new one is a row here', async () => {
            // DERIVED from the record, never a written list: `childFacts` is the only
            // party that knows what it answers, and a field added to it without a row
            // above is a fact nothing holds against a wrapper.
            expect(FACTS.map((fact) => fact.key).sort()).toStrictEqual(Object.keys(factsOf(null)).sort());
        });

        for (const fact of FACTS) {
            for (const carrier of fact.carriers) {
                for (const wrapper of WRAPPERS) {
                    await it(`${fact.key}: ${carrier.name} inside ${wrapper.name}`, async () => {
                        expect(fact.intact(factsOf(wrapper.wrap(carrier.node)), wrapper)).toBe(true);
                    });
                }
            }
            const absent = fact.absent;
            const quiet = fact.quiet;
            if (absent === undefined || quiet === undefined) continue;
            for (const wrapper of WRAPPERS) {
                await it(`${fact.key}: ${absent.name} inside ${wrapper.name} does NOT report it`, async () => {
                    expect(quiet(factsOf(wrapper.wrap(absent.node)))).toBe(true);
                });
            }
        }
    });

    await describe('what expanding a Fragment must not change', async () => {
        await it('keeps every child key unique, composed behind its Fragment’s', async () => {
            // A collision is a remount on every update, and React reports it as a
            // duplicate-key warning at best — which nothing in a GJS process reads.
            const nodes = childNodes(
                createElement(
                    Fragment,
                    null,
                    createElement(Fragment, { key: 'left' }, createElement(View, { key: 'row' })),
                    createElement(Fragment, { key: 'right' }, createElement(View, { key: 'row' })),
                ),
            );
            const keys = nodes.map((node) => (node as { key: string | null }).key);
            expect(keys.length).toBe(2);
            expect(new Set(keys).size).toBe(2);
        });

        await it('keeps the expanded child’s own props, ref included', async () => {
            const ref = (): void => undefined;
            const nodes = childNodes(
                createElement(Fragment, null, createElement(View, { className: 'absolute', ref })),
            );
            const props = (nodes[0] as { props: Record<string, unknown> }).props;
            expect(props.className).toBe('absolute');
            expect(props.ref).toBe(ref);
        });

        await it('still drops what Children.toArray drops', async () => {
            // `{cond && <Row/>}` short-circuiting must not become a child under the
            // expansion either, or `count` disagrees with Solid's for a tree neither
            // author would call different (`solid/index.ts`' `factsOf`).
            expect(factsOf(createElement(Fragment, null, false, null, undefined)).count).toBe(0);
        });

        await it('re-keys ONLY what came out of a Fragment', async () => {
            // A blanket re-key would change the identity of every sibling of a
            // Fragment, and React answers a changed key by unmounting the subtree and
            // building it again — a remount on every render, which looks like a slow
            // application rather than a bug.
            const nodes = childNodes([
                createElement(View, { key: 'sibling' }),
                createElement(Fragment, { key: 'group' }, createElement(View, { key: 'inner' })),
            ]);
            expect((nodes[0] as { key: string | null }).key).toBe('.$sibling');
            expect((nodes[1] as { key: string | null }).key).toBe('.$group.$inner');
        });
    });

    await describe('what a parent still refuses to judge', async () => {
        await it('answers “not absolute” for a FOREIGN child whose vocabulary is not this layer’s', async () => {
            // The `catch` in `isAbsoluteChild` earns its keep here and nowhere else: a
            // composite that never reaches L2 may carry any class list at all, and a
            // parent must not throw for it. The child itself is refused by name if it
            // ever does reach L2.
            const Card = (): null => null;
            expect(factsOf(createElement(Card, { className: 'card-lg-not-a-utility' })).absolute).toBe(0);
        });
    });
};
