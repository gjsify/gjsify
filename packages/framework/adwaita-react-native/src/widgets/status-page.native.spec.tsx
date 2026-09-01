/** @jsxImportSource react */
// The React Native half of `AdwStatusPage`, rendered through React's real reconciler.
//
// THE ROWS ARE `status-page.gtk.spec.tsx`'S, MINUS ONE AND PLUS ONE. The two
// `string_is_not_empty` decisions are asserted on both halves against the same inputs —
// `''` collapses a label, `'   '` does not — and the GTK suite reads them off the live
// labels' `visible` while this one reads each `Text`'s `display`.
//
// THE ONE THIS HALF HAS INSTEAD OF THE ICON is the ABSENCE of the icon, and it is pinned
// rather than left to the README. `icon-name` names an entry in an icon theme and React
// Native has none, so this half draws nothing for it; the assertion is that the tree
// holds exactly two `Text`s whatever `iconName` says, so the day an icon node appears it
// is a decision someone made and not a divergence that drifted shut.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_TEXT, RCT_VIEW, View } from '../testing/react-native.js';
import { at, childrenOf, mounted, textOf, type Style } from '../testing/render.spec.js';
import { AdwStatusPage } from './status-page.native.js';

/** `[title, description]` as `[text, style]` pairs. */
function labels(element: React.ReactElement): Array<[string, Style]> {
    return childrenOf(mounted(element))
        .filter((child) => child.type === RCT_TEXT)
        .map((child) => [textOf(child), child.props.style as Style]);
}

/** `visible=False` on a label, as React Native spells "not in layout". */
const COLLAPSED = { display: 'none' };

export default async () => {
    await describe('AdwStatusPage on React Native — the tree it emits', async () => {
        await it('is a centring View holding the two labels and then the child', async () => {
            // The order is the template's (adw-status-page.ui): the child comes LAST and
            // is unconditional, which is what makes an action button land below the
            // description rather than beside it.
            const tree = mounted(
                <AdwStatusPage title="Nothing here" description="Add a file">
                    <View testID="action" />
                </AdwStatusPage>,
            );
            expect(tree.type).toBe(RCT_VIEW);
            expect(tree.props.style as Style).toStrictEqual({
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
            });
            const children = childrenOf(tree);
            expect(children.map((child) => child.type)).toStrictEqual([RCT_TEXT, RCT_TEXT, RCT_VIEW]);
            expect(at(children, 2).props.testID).toBe('action');
        });

        await it('renders no icon node, whatever iconName says', async () => {
            // The divergence, from this side. `@gjsify/adwaita-nativescript` hit the same
            // wall and substituted an SVG STRING under the same property name; there is
            // no equivalent here, and drawing the NAME would put `folder-symbolic` on
            // screen. `status-page.gtk.spec.tsx` asserts the icon IS shown on the other
            // half, including for a name the theme cannot resolve.
            const withIcon = childrenOf(mounted(<AdwStatusPage iconName="folder-symbolic" title="Nothing here" />));
            const without = childrenOf(mounted(<AdwStatusPage title="Nothing here" />));
            expect(withIcon.map((child) => child.type)).toStrictEqual([RCT_TEXT, RCT_TEXT]);
            expect(withIcon.map((child) => child.type)).toStrictEqual(without.map((child) => child.type));
        });
    });

    await describe('AdwStatusPage on React Native — the visibility rule', async () => {
        await it('shows both labels when both are set', async () => {
            expect(labels(<AdwStatusPage title="Nothing here" description="Add a file" />)).toStrictEqual([
                ['Nothing here', undefined],
                ['Add a file', undefined],
            ]);
        });

        await it('collapses the description label when the description is empty', async () => {
            expect(labels(<AdwStatusPage title="Nothing here" description="" />)).toStrictEqual([
                ['Nothing here', undefined],
                ['', COLLAPSED],
            ]);
        });

        await it('collapses the TITLE label when the title is empty', async () => {
            expect(labels(<AdwStatusPage title="" description="Add a file" />)).toStrictEqual([
                ['', COLLAPSED],
                ['Add a file', undefined],
            ]);
        });

        await it('keeps a title of three SPACES visible — the closure never trims', async () => {
            expect(labels(<AdwStatusPage title="   " description="" />)).toStrictEqual([
                ['   ', undefined],
                ['', COLLAPSED],
            ]);
        });
    });
};
