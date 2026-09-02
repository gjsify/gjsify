/** @jsxImportSource react */
// The React Native half of `AdwHeaderBar`, rendered through React's real reconciler.
//
// THE SHAPE IS THE ASSERTION, and it is `@gjsify/adwaita-nativescript`'s shape: three
// slots in a row, the two ends hugging their contents and the centre taking what is left.
// That port spells it as a `GridLayout` with columns `auto, *, auto`; the React Native
// spelling of the middle column is `flex: 1`, and this suite asserts the three style
// objects rather than "there are three views" — a bar whose centre did not expand would
// pass a shape assertion and look wrong on every screen.
//
// THE CENTRE IS THE PART WITH A DECISION IN IT. Two of its three states exist on this
// half: a `titleWidget` holds it, or a real `AdwWindowTitle` does. The third — nothing
// authored, so libadwaita resolves the window's own title — is GTK-only and
// `header-bar.gtk.spec.tsx` asserts it there; here an unauthored title is a collapsed
// label, which this suite pins so the asymmetry stays visible from both sides.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_TEXT, RCT_VIEW, View } from '../testing/react-native.js';
import { at, childrenOf, mounted, textOf, type Style } from '../testing/render.spec.js';
import { AdwHeaderBar } from './header-bar.native.js';

/** `auto` — the slot hugs its contents. */
const HUG = { flexDirection: 'row', alignItems: 'center' };

/** `*` — the centre takes what is left and centres what it holds. */
const CENTRE = { flex: 1, alignItems: 'center', justifyContent: 'center' };

export default async () => {
    await describe('AdwHeaderBar on React Native — the tree it emits', async () => {
        await it('is a row of three slots: hug, expand, hug', async () => {
            const tree = mounted(<AdwHeaderBar title="Files" />);
            expect(tree.type).toBe(RCT_VIEW);
            expect(tree.props.style as Style).toStrictEqual({ flexDirection: 'row', alignItems: 'center' });
            const slots = childrenOf(tree);
            expect(slots.map((slot) => slot.type)).toStrictEqual([RCT_VIEW, RCT_VIEW, RCT_VIEW]);
            expect(slots.map((slot) => slot.props.style as Style)).toStrictEqual([HUG, CENTRE, HUG]);
        });

        await it('puts start in the first slot and end in the last', async () => {
            const slots = childrenOf(
                mounted(
                    <AdwHeaderBar title="Files" start={<View testID="leading" />} end={<View testID="trailing" />} />,
                ),
            );
            expect(childrenOf(at(slots, 0)).map((child) => child.props.testID)).toStrictEqual(['leading']);
            expect(childrenOf(at(slots, 2)).map((child) => child.props.testID)).toStrictEqual(['trailing']);
        });

        await it('keeps the order the end prop was written in', async () => {
            // A prop is already DRAW order, so `adw_header_bar_pack_end`'s PREPEND
            // (adw-header-bar.c:1106) — the rule `HeaderBarState` exists to get right
            // imperatively, and the one the NativeScript port had backwards — cannot be
            // got wrong here. Asserted so that a future half cannot "fix" it into a
            // reversal.
            const slots = childrenOf(
                mounted(
                    <AdwHeaderBar
                        title="Files"
                        end={
                            <>
                                <View testID="first" />
                                <View testID="second" />
                            </>
                        }
                    />,
                ),
            );
            expect(childrenOf(at(slots, 2)).map((child) => child.props.testID)).toStrictEqual(['first', 'second']);
        });
    });

    await describe('AdwHeaderBar on React Native — the centre', async () => {
        await it('fills the centre with an AdwWindowTitle carrying title and subtitle', async () => {
            // The DIVERGENCE both other renderers carry and this one keeps:
            // `Adw.HeaderBar` has no `title` property, and its derived centre is a plain
            // label with no subtitle at all.
            const centre = at(childrenOf(mounted(<AdwHeaderBar title="Files" subtitle="3 selected" />)), 1);
            const stack = at(childrenOf(centre), 0);
            expect(stack.props.style as Style).toStrictEqual({ alignItems: 'center' });
            const texts = childrenOf(stack);
            expect(texts.map((text) => text.type)).toStrictEqual([RCT_TEXT, RCT_TEXT]);
            expect(texts.map((text) => textOf(text))).toStrictEqual(['Files', '3 selected']);
        });

        await it('gives the centre to a titleWidget instead, never to both', async () => {
            const centre = at(
                childrenOf(mounted(<AdwHeaderBar title="Files" titleWidget={<View testID="entry" />} />)),
                1,
            );
            const held = childrenOf(centre);
            expect(held.length).toBe(1);
            expect(at(held, 0).type).toBe(RCT_VIEW);
            expect(at(held, 0).props.testID).toBe('entry');
        });

        await it('leaves a blank centre when nothing is authored — the GTK half resolves one', async () => {
            // The asymmetry, from this side. `update_title`'s chain is an ancestry walk
            // (navigation page → dialog → window → application name) and a phone has none
            // of those, so both labels collapse; `header-bar.gtk.spec.tsx` asserts the
            // other half showing the window's own title for the same props.
            const centre = at(childrenOf(mounted(<AdwHeaderBar />)), 1);
            const texts = childrenOf(at(childrenOf(centre), 0));
            expect(texts.map((text) => text.props.style as Style)).toStrictEqual([
                { display: 'none' },
                { display: 'none' },
            ]);
        });
    });
};
