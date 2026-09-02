/** @jsxImportSource react */
// The React Native half of `AdwToolbarView`, rendered through React's real reconciler.
//
// THE TREE IS ALWAYS THREE VIEWS, and the extend flags change only the style of the first
// and the last. That is the claim, and it is asserted as three exact style objects rather
// than as "there are three views": a content slot that lost its `flex: 1` would pass a
// shape assertion and collapse to nothing on a device, and a bar that stayed in the flow
// under `extend-content-to-top-edge` would push the content down instead of being drawn
// over it.
//
// `zIndex` IS PART OF THE ASSERTION. `@gjsify/adwaita-nativescript` has to re-append its
// bar boxes so they paint over the content, because NativeScript paints siblings in add
// order and its CSS subset has no `z-index`; React Native has one, so this half leaves
// the tree order alone and says so in the style. Dropping it would leave a bar that is
// positioned correctly and painted UNDER the content — invisible in a tree assertion that
// only looked at `position`.
//
// AND THE TWO STYLE PROPS REACH NO STYLE, asserted. `topBarStyle` / `bottomBarStyle`
// derive four CSS classes on GTK (`toolbarViewClasses`, measured against libadwaita in
// `toolbar-view.gtk.spec.tsx`) and React Native has no class system to stamp them into.
// Pinning the absence is what keeps that a decision rather than something that quietly
// changes.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_VIEW, View } from '../testing/react-native.js';
import { at, childrenOf, mounted, type Style } from '../testing/render.spec.js';
import { AdwToolbarView } from './toolbar-view.native.js';

/** The three slots of one mounted toolbar view. */
const slots = (element: React.ReactElement) => childrenOf(mounted(element));

const OVER_TOP = { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 };
const OVER_BOTTOM = { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1 };

export default async () => {
    await describe('AdwToolbarView on React Native — the tree it emits', async () => {
        await it('is a column of three views, and the content is the one that grows', async () => {
            const tree = mounted(
                <AdwToolbarView topBar={<View testID="bar" />} bottomBar={<View testID="status" />}>
                    <View testID="content" />
                </AdwToolbarView>,
            );
            expect(tree.type).toBe(RCT_VIEW);
            expect(tree.props.style as Style).toStrictEqual({ flex: 1, flexDirection: 'column' });
            const three = childrenOf(tree);
            expect(three.map((slot) => slot.type)).toStrictEqual([RCT_VIEW, RCT_VIEW, RCT_VIEW]);
            expect(three.map((slot) => slot.props.style as Style)).toStrictEqual([undefined, { flex: 1 }, undefined]);
        });

        await it('puts each prop in its own slot, in bar / content / bar order', async () => {
            const three = slots(
                <AdwToolbarView topBar={<View testID="bar" />} bottomBar={<View testID="status" />}>
                    <View testID="content" />
                </AdwToolbarView>,
            );
            expect(three.map((slot) => at(childrenOf(slot), 0).props.testID)).toStrictEqual([
                'bar',
                'content',
                'status',
            ]);
        });

        await it('keeps all three slots when a bar is absent, so the tree shape is stable', async () => {
            // A flag flip or a bar arriving late must not unmount the content: React
            // reconciles three views either way, and an empty View is zero-sized.
            const three = slots(
                <AdwToolbarView>
                    <View testID="content" />
                </AdwToolbarView>,
            );
            expect(three.length).toBe(3);
            expect(at(three, 0).children).toBe(null);
            expect(at(three, 2).children).toBe(null);
        });
    });

    await describe('AdwToolbarView on React Native — the extend flags', async () => {
        await it('takes an extended top bar out of the flow and paints it over the content', async () => {
            const three = slots(
                <AdwToolbarView extendContentToTopEdge={true} topBar={<View testID="bar" />}>
                    <View testID="content" />
                </AdwToolbarView>,
            );
            expect(at(three, 0).props.style as Style).toStrictEqual(OVER_TOP);
            // The content keeps `flex: 1` and is now alone in the column, which is what
            // "the content spans the full height" means here.
            expect(at(three, 1).props.style as Style).toStrictEqual({ flex: 1 });
        });

        await it('does the same at the other edge, independently', async () => {
            const three = slots(
                <AdwToolbarView
                    extendContentToBottomEdge={true}
                    topBar={<View testID="bar" />}
                    bottomBar={<View testID="status" />}
                >
                    <View testID="content" />
                </AdwToolbarView>,
            );
            expect(at(three, 0).props.style as Style).toBe(undefined);
            expect(at(three, 2).props.style as Style).toStrictEqual(OVER_BOTTOM);
        });
    });

    await describe('AdwToolbarView on React Native — the divergence, pinned', async () => {
        await it('carries the two bar styles into no style at all', async () => {
            const styled = slots(
                <AdwToolbarView topBarStyle="raised-border" bottomBarStyle="raised" topBar={<View testID="bar" />}>
                    <View testID="content" />
                </AdwToolbarView>,
            );
            const plain = slots(
                <AdwToolbarView topBar={<View testID="bar" />}>
                    <View testID="content" />
                </AdwToolbarView>,
            );
            expect(styled.map((slot) => slot.props.style as Style)).toStrictEqual(
                plain.map((slot) => slot.props.style as Style),
            );
        });
    });
};
