/** @jsxImportSource react */
// The React Native half of `AdwOverlaySplitView`, rendered through React's real
// reconciler.
//
// THE NUMBERS ARE THE GTK HALF'S. `navigation.gtk.spec.tsx` reads 250 / 750 off a real
// `Adw.OverlaySplitView` in a 1000-point window and 280 off a COLLAPSED one in a
// 360-point window; this suite asserts the same three numbers as style objects, because
// `resolveOverlaySidebarWidth` and `layoutOverlaySplitView` are the C's arithmetic and
// neither renderer invented it. 280 on a 360-point phone is the one worth naming: a
// collapsed overlay IGNORES `sidebar-width-fraction` and clamps the VIEW width instead,
// so a `width: '25%'` would draw 90.
//
// THE PANE RECTS ARE ASSERTED AS `left` AND `width`, which is what the core returns and
// what this half writes. A hidden docked sidebar is at `left: -250` — it is placed OFF
// the leading edge rather than removed, which is what makes the reveal a continuum, and
// `opacity: 0` is the snapshot gate the C applies at zero progress.
//
// EACH PANE CARRIES A `Text` THAT NAMES IT, for the reason
// `navigation-split-view.native.spec.tsx` gives: three bare `View`s in paint order are
// indistinguishable, so an index-based assertion would survive the content and the
// sidebar swapping places.

import { describe, expect, it } from '@gjsify/unit';
import { act } from 'react-test-renderer';

import { Text } from '../testing/react-native.js';
import {
    at,
    childrenOf,
    deliverLayout,
    mount,
    onlyChild,
    settled,
    textOf,
    type Style,
} from '../testing/render.spec.js';
import { AdwOverlaySplitView } from './overlay-split-view.native.js';

/** The frame the GTK half is photographed in, so both are asked the same question. */
const FRAME_WIDTH = 1000;

/** The narrow frame the collapsed case is measured in — a phone, in points. */
const PHONE_FRAME_WIDTH = 360;

/** An overlay split view whose two panes name themselves. */
function overlay(props: Record<string, unknown> = {}) {
    return (
        <AdwOverlaySplitView sidebar={<Text>sidebar</Text>} sidebarWidthUnit="px" {...props}>
            <Text>content</Text>
        </AdwOverlaySplitView>
    );
}

/** The name the pane at `index` is carrying. */
function paneName(nodes: ReturnType<typeof childrenOf>, index: number): string {
    return textOf(onlyChild(at(nodes, index)));
}

export default async () => {
    await describe('AdwOverlaySplitView on React Native — the docked allocation', async () => {
        await it('splits a 1000-point frame 250 / 750, where GTK reads the same pair', async () => {
            const nodes = childrenOf(settled(overlay(), FRAME_WIDTH));
            // Content, then sidebar: no shield while docked, and the paint order is
            // content < shield < sidebar.
            expect(nodes.length).toBe(2);
            expect(paneName(nodes, 0)).toBe('content');
            expect(paneName(nodes, 1)).toBe('sidebar');
            expect(at(nodes, 0).props.style as Style).toStrictEqual({
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 250,
                width: 750,
            });
            expect(at(nodes, 1).props.style as Style).toStrictEqual({
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 250,
                opacity: 1,
            });
        });

        await it('slides a hidden docked sidebar off the leading edge rather than dropping it', async () => {
            const nodes = childrenOf(settled(overlay({ showSidebar: false }), FRAME_WIDTH));
            expect(nodes.length).toBe(2);
            expect(paneName(nodes, 1)).toBe('sidebar');
            // The content takes the whole frame…
            expect((at(nodes, 0).props.style as Record<string, unknown>).width).toBe(FRAME_WIDTH);
            // …and the sidebar is at -250, unpainted. Its NODE is still there, which is
            // what makes "hidden" different from "never rendered".
            expect(at(nodes, 1).props.style as Style).toStrictEqual({
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: -250,
                width: 250,
                opacity: 0,
            });
        });
    });

    await describe('AdwOverlaySplitView on React Native — the collapsed overlay', async () => {
        await it('gives the sidebar 280 on a 360-point phone, where a quarter would be 90', async () => {
            const nodes = childrenOf(settled(overlay({ collapsed: true, pinSidebar: true }), PHONE_FRAME_WIDTH));
            // Content, shield, sidebar — the shield exists only while collapsed AND
            // revealed, so its presence is itself the assertion, and the third node is
            // read by NAME rather than by index.
            expect(nodes.length).toBe(3);
            expect(paneName(nodes, 0)).toBe('content');
            expect(paneName(nodes, 2)).toBe('sidebar');
            expect(at(nodes, 1).children).toBe(null);
            expect((at(nodes, 0).props.style as Record<string, unknown>).width).toBe(PHONE_FRAME_WIDTH);
            // `shadowProgress` is 0 at full reveal, so the shield is fully opaque.
            expect((at(nodes, 1).props.style as Record<string, unknown>).opacity).toBe(1);
            expect(at(nodes, 2).props.style as Style).toStrictEqual({
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 280,
                opacity: 1,
            });
        });

        await it('drops the shield and the reveal when an unpinned sidebar is collapsed', async () => {
            // The collapse COUPLING: `set_collapsed` hides an unpinned sidebar itself, so
            // this case authors no `showSidebar` at all and still ends up hidden. Applying
            // the props in any other order leaves it shown — which is the ordering
            // measurement both halves of this widget carry at their head.
            const nodes = childrenOf(settled(overlay({ collapsed: true }), PHONE_FRAME_WIDTH));
            expect(nodes.length).toBe(2);
            expect(paneName(nodes, 1)).toBe('sidebar');
            expect((at(nodes, 1).props.style as Record<string, unknown>).opacity).toBe(0);
            // Off the leading edge by its full width, not merely transparent.
            expect((at(nodes, 1).props.style as Record<string, unknown>).left).toBe(-280);
        });

        await it('pins and collapses in ONE commit without losing the sidebar', async () => {
            // THE WRITE ORDER, AS A THING THAT GOES RED. `setCollapsed` hides an
            // UNPINNED sidebar itself, so the effect has to push `pin-sidebar` first —
            // and on a commit that changes both, "first" is nothing but the order of two
            // lines in one function body. Measured with those two lines swapped: the
            // sidebar came back at `left: -280, opacity: 0` and every other test in this
            // package stayed green, because they all reach the two flags either at mount
            // or in separate commits. This is the row that fails.
            //
            // Its twin is in `navigation.gtk.spec.tsx`, where the same two props change
            // in one `rerender` and gtk-host writes them in ELEMENT order.
            const view = (pinned: boolean) => overlay({ pinSidebar: pinned, collapsed: pinned });
            const renderer = mount(view(false));
            deliverLayout(renderer, PHONE_FRAME_WIDTH);
            act(() => {
                renderer.update(view(true));
            });
            const nodes = childrenOf(deliverLayout(renderer, PHONE_FRAME_WIDTH));
            // Content, shield, sidebar — the shield is there only while collapsed AND
            // revealed, so its presence is half the assertion.
            expect(nodes.length).toBe(3);
            expect(paneName(nodes, 2)).toBe('sidebar');
            expect(at(nodes, 2).props.style as Style).toStrictEqual({
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 280,
                opacity: 1,
            });
        });

        await it('reports the value the widget settled on, not the one it was given', async () => {
            // AN UPDATE, NOT A MOUNT, and that is the honest question. The subscription is
            // installed in an effect, so a change the CONSTRUCTOR made has no listener yet
            // — on both halves, where gtk-host likewise writes the widget's properties
            // before anything is bound. What a caller can observe is every change after
            // that, which is where the collapse coupling actually bites.
            const seen: boolean[] = [];
            const view = (collapsed: boolean) =>
                overlay({ collapsed, onNotifyShowSidebar: (value: boolean) => seen.push(value) });
            const renderer = mount(view(false));
            expect(seen).toStrictEqual([]);
            act(() => {
                renderer.update(view(true));
            });
            // Nobody authored `showSidebar`: collapsing an UNPINNED sidebar hides it.
            expect(seen).toStrictEqual([false]);
            act(() => {
                renderer.update(view(false));
            });
            expect(seen).toStrictEqual([false, true]);
        });
    });
};
