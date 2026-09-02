/** @jsxImportSource react */
// The React Native half of `AdwNavigationPage`, rendered through React's real reconciler.
//
// THE WHOLE WIDGET IS ONE NODE AND THREE PROPERTIES THAT REACH NO NODE, so that is what
// this file asserts — including the absence, in the shape the README's icon rule uses.
// `title`, `tag` and `can-pop` are read by the page's HOLDER on this half
// (`navigation-view.native.tsx` hands them to `NavigationViewState`), and a page that
// started forwarding them onto its `View` would be inventing React Native props no
// platform has. Asserting the absence is what makes the day one appears a decision.
//
// `flex: 1` IS ASSERTED, not assumed: a navigation page is the whole screen inside its
// view, and a default-sized `View` would collapse to its content — a divergence from the
// GTK half that renders as a page with a blank area under it, at exit 0.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_VIEW } from '../testing/react-native.js';
import { mounted, onlyChild, type Style } from '../testing/render.spec.js';
import { AdwNavigationPage } from './navigation-page.native.js';

export default async () => {
    await describe('AdwNavigationPage on React Native — the tree it emits', async () => {
        await it('is one view that fills its holder', async () => {
            const tree = mounted(
                <AdwNavigationPage title="Home" tag="home">
                    {null}
                </AdwNavigationPage>,
            );
            expect(tree.type).toBe(RCT_VIEW);
            expect(tree.props.style as Style).toStrictEqual({ flex: 1 });
        });

        await it('carries none of its three properties onto the view', async () => {
            const tree = mounted(
                <AdwNavigationPage title="Home" tag="home" canPop={false}>
                    {null}
                </AdwNavigationPage>,
            );
            // Named one by one rather than by counting keys: a key count passes when a
            // prop is renamed as well as when it is absent.
            expect(tree.props.title).toBe(undefined);
            expect(tree.props.tag).toBe(undefined);
            expect(tree.props.canPop).toBe(undefined);
        });

        await it('holds its child, which is the whole of what a bin does', async () => {
            const tree = mounted(
                <AdwNavigationPage title="Home">
                    <AdwNavigationPage title="Nested">{null}</AdwNavigationPage>
                </AdwNavigationPage>,
            );
            expect(onlyChild(tree).type).toBe(RCT_VIEW);
        });
    });
};
