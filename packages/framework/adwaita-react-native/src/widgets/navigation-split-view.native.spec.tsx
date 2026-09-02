/** @jsxImportSource react */
// The React Native half of `AdwNavigationSplitView`, rendered through React's real
// reconciler.
//
// THE NUMBERS IN THIS FILE ARE THE NUMBERS THE GTK HALF IS ASSERTED WITH.
// `navigation.gtk.spec.tsx` puts the real `Adw.NavigationSplitView` in a 1000-point
// window, photographs it, and reads the two panes back at 250 and 750 off the live GTK
// tree. This suite renders the React Native module at the same width and asserts the same
// pair as two style objects — neither renderer invented them,
// `resolveNavigationSidebarWidth` and `layoutNavigationSplitView` did.
//
// EVERY PANE CARRIES A `Text` THAT NAMES IT, and that is not decoration. A pane is a bare
// `View`, so "one pane is on screen" is true of the sidebar and of the content alike —
// measured: an assertion that counted the panes passed with `resolveNavigationStack`
// replaced by `showContent ? 'content' : 'sidebar'`, which is precisely the rule this
// widget exists to get right. Reading the text back is what makes the count a statement
// about WHICH pane.
//
// WHAT IS ABSENT IS YOGA, exactly as for `AdwClamp`: a `width` in a style object is an
// INSTRUCTION to a layout engine that is not in this process, so every assertion here is
// about what the widget ASKS FOR. The matching "and it got it" is the GTK photograph.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_VIEW, Text } from '../testing/react-native.js';
import { at, childrenOf, mounted, onlyChild, settled, textOf, type Style } from '../testing/render.spec.js';
import { AdwNavigationSplitView } from './navigation-split-view.native.js';

/** The frame the GTK half is photographed in, so both are asked the same question. */
const FRAME_WIDTH = 1000;

/** A split view whose two panes name themselves. */
function splitView(props: Record<string, unknown> = {}) {
    return (
        <AdwNavigationSplitView sidebar={<Text>sidebar</Text>} sidebarWidthUnit="px" {...props}>
            <Text>content</Text>
        </AdwNavigationSplitView>
    );
}

/** The name the pane at `index` is carrying. */
function paneName(panes: ReturnType<typeof childrenOf>, index: number): string {
    return textOf(onlyChild(at(panes, index)));
}

export default async () => {
    await describe('AdwNavigationSplitView on React Native — the allocation it asks for', async () => {
        await it('splits a 1000-point frame 250 / 750, where GTK reads the same pair', async () => {
            const panes = childrenOf(settled(splitView(), FRAME_WIDTH));
            expect(panes.length).toBe(2);
            expect(paneName(panes, 0)).toBe('sidebar');
            expect(at(panes, 0).props.style as Style).toStrictEqual({ width: 250 });
            expect(paneName(panes, 1)).toBe('content');
            expect(at(panes, 1).props.style as Style).toStrictEqual({ width: 750 });
        });

        await it('puts the sidebar LAST for sidebar-position: end, following the rects', async () => {
            const panes = childrenOf(settled(splitView({ sidebarPosition: 'end' }), FRAME_WIDTH));
            // Draw ORDER, taken from the rects rather than from a second predicate: the
            // core returned `content.x = 0` and `sidebar.x = 750`.
            expect(paneName(panes, 0)).toBe('content');
            expect(at(panes, 0).props.style as Style).toStrictEqual({ width: 750 });
            expect(paneName(panes, 1)).toBe('sidebar');
            expect(at(panes, 1).props.style as Style).toStrictEqual({ width: 250 });
        });

        await it('leaves both panes unsized before the first layout', async () => {
            const tree = mounted(splitView());
            expect(tree.type).toBe(RCT_VIEW);
            expect(typeof tree.props.onLayout).toBe('function');
            for (const pane of childrenOf(tree)) expect(pane.props.style as Style).toBe(undefined);
        });

        await it('truncates the fraction, as the C’s (int) cast does', async () => {
            // 0.333 of 1000 is 333.0 and `Math.trunc` is what the C does; the value is
            // then clamped into 180…280, so the truncation is only VISIBLE with the
            // maximum raised — which is why both halves of the rule are asserted.
            const clamped = childrenOf(settled(splitView({ sidebarWidthFraction: 0.333 }), FRAME_WIDTH));
            expect(at(clamped, 0).props.style as Style).toStrictEqual({ width: 280 });

            const wider = childrenOf(
                settled(splitView({ sidebarWidthFraction: 0.333, maxSidebarWidth: 500 }), FRAME_WIDTH),
            );
            expect(at(wider, 0).props.style as Style).toStrictEqual({ width: 333 });
        });
    });

    await describe('AdwNavigationSplitView on React Native — the ordering table', async () => {
        await it('shows the SIDEBAR when collapsed and show-content is false', async () => {
            const tree = settled(splitView({ collapsed: true }), FRAME_WIDTH);
            expect(childrenOf(tree).length).toBe(1);
            expect(paneName(childrenOf(tree), 0)).toBe('sidebar');
            expect(onlyChild(tree).props.style as Style).toStrictEqual({ flex: 1 });
        });

        await it('shows the CONTENT when collapsed and show-content is true', async () => {
            const tree = settled(splitView({ collapsed: true, showContent: true }), FRAME_WIDTH);
            expect(paneName(childrenOf(tree), 0)).toBe('content');
        });

        await it('keeps a LONE child visible whatever show-content says', async () => {
            // The rule two CSS classes cannot express: `show-content` asks for a content
            // pane that is not mounted, so the sidebar stays on screen. Keying the swap on
            // the flag renders this case with an EMPTY pane — the bug
            // `@gjsify/adwaita-nativescript` records against its own `_applyLayout`, and
            // the reason this assertion reads the pane's name rather than counting panes.
            const tree = settled(
                <AdwNavigationSplitView sidebar={<Text>sidebar</Text>} collapsed={true} showContent={true} />,
                FRAME_WIDTH,
            );
            expect(childrenOf(tree).length).toBe(1);
            expect(paneName(childrenOf(tree), 0)).toBe('sidebar');
        });

        // `sidebar-position: end` IS NOT ASSERTED IN THIS DESCRIBE, and that is a
        // measurement rather than an oversight. `resolveNavigationStack`'s `end` branch
        // builds the stack the other way round — the CONTENT is the root page and the
        // sidebar is pushed on top of it — but the LAST entry, which is the pane on
        // screen, is the same for both positions at every value of `show-content`. What
        // actually differs is the push/pop DIRECTION, which a renderer spends on a slide
        // and this one has none of (`props.ts` names the absent animation). Measured: a
        // test written here passed with `setSidebarPosition` pinned to `'start'`, which
        // is the shape of an assertion that asserts nothing. The position IS asserted,
        // where it is observable — on the docked draw order, above.

        await it('renders no pane at all when neither is mounted', async () => {
            const tree = settled(<AdwNavigationSplitView collapsed={true} />, FRAME_WIDTH);
            // Not "renders something empty": an empty stack has no visible pane, so the
            // view is one node with no children.
            expect(tree.children).toBe(null);
        });
    });
};
