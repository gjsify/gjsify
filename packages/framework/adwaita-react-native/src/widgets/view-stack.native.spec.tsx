/** @jsxImportSource react */
// The React Native half of `AdwViewStack`, rendered through React's real reconciler.
//
// THE SELECTION IS THE CLAIM, and every rule asserted below is one `ViewStackState`
// answers for all three Adwaita renderers — the same class `@gjsify/adwaita-web`'s
// `<adw-view-stack>` and `@gjsify/adwaita-nativescript`'s `AdwViewStack` run.
// `navigation.gtk.spec.tsx` reads the first two off the real `Adw.ViewStack`: the
// auto-pick lands on `home`, and an authored `visible-child-name` moves it.
//
// AN UNKNOWN NAME IS REFUSED AND NOT CLAMPED, which is the row a hand-written selection
// would get wrong in the expensive direction: `adw_view_stack_set_visible_child_name`
// warns and leaves the selection where it was, so a typo'd prop shows the PREVIOUS page
// rather than page 0 or nothing. Asserting the refusal is what stops a "helpful" fallback
// being added later.
//
// EVERY PAGE STAYS MOUNTED. The unselected ones carry `display: 'none'`, which is what
// both other renderers do (`hidden`, `visibility: 'collapse'`); a stack that rendered
// only the selected page would lose the others' component state on every switch. What is
// absent is Yoga, as everywhere in this package: `display` is an instruction to a layout
// engine that is not in this process.

import { describe, expect, it } from '@gjsify/unit';
import { act } from 'react-test-renderer';

import { Text } from '../testing/react-native.js';
import { at, childrenOf, mount, mounted, onlyChild, textOf } from '../testing/render.spec.js';
import { AdwViewStack } from './view-stack.native.js';

/** Which page index the tree is showing. */
function displayed(node: ReturnType<typeof mounted>): number[] {
    return childrenOf(node)
        .map((child, index) => ((child.props.style as { display?: string }).display === undefined ? index : -1))
        .filter((index) => index >= 0);
}

// Each body names itself, so an assertion can say WHICH page is on screen rather than
// only how many are — three bare `View`s are otherwise indistinguishable.
const PAGES = [
    { name: 'home', title: 'Home', child: <Text>home</Text> },
    { name: 'detail', title: 'Detail', child: <Text>detail</Text> },
    { name: 'settings', title: 'Settings', child: <Text>settings</Text> },
];

/** The name of the page the tree is showing. */
function shownName(node: ReturnType<typeof mounted>): string {
    const index = displayed(node)[0];
    if (index === undefined) throw new Error('no page is displayed');
    return textOf(onlyChild(at(childrenOf(node), index)));
}

export default async () => {
    await describe('AdwViewStack on React Native — the selection', async () => {
        await it('auto-picks the first visible page, as add() does on GTK', async () => {
            const tree = mounted(<AdwViewStack pages={PAGES} />);
            expect(childrenOf(tree).length).toBe(3);
            expect(displayed(tree)).toStrictEqual([0]);
        });

        await it('shows the page an authored visible-child-name names', async () => {
            const tree = mounted(<AdwViewStack pages={PAGES} visibleChildName="settings" />);
            expect(displayed(tree)).toStrictEqual([2]);
            expect(shownName(tree)).toBe('settings');
        });

        await it('refuses an unknown name instead of clamping it', async () => {
            const tree = mounted(<AdwViewStack pages={PAGES} visibleChildName="nowhere" />);
            // The auto-pick still holds — NOT page 0 by accident: `home` IS page 0, so the
            // second half of this assertion is the one that carries the claim, and it is
            // made with a stack whose auto-pick is page 1.
            expect(displayed(tree)).toStrictEqual([0]);

            const hiddenFirst = mounted(
                <AdwViewStack
                    pages={[{ name: 'home', title: 'Home', visible: false }, ...PAGES.slice(1)]}
                    visibleChildName="nowhere"
                />,
            );
            // The auto-pick skipped the invisible page 0, and the unknown name did not
            // move it back.
            expect(displayed(hiddenFirst)).toStrictEqual([1]);
        });

        await it('skips a page that is not visible when picking', async () => {
            const tree = mounted(
                <AdwViewStack pages={[{ name: 'home', title: 'Home', visible: false }, ...PAGES.slice(1)]} />,
            );
            expect(displayed(tree)).toStrictEqual([1]);
            expect(shownName(tree)).toBe('detail');
        });

        await it('refuses to select a page that is not visible', async () => {
            const tree = mounted(
                <AdwViewStack
                    pages={[
                        { name: 'home', title: 'Home' },
                        { name: 'detail', title: 'Detail', visible: false },
                    ]}
                    visibleChildName="detail"
                />,
            );
            // `adw_view_stack_pages_select_item` simply returns FALSE for a hidden page,
            // so the auto-pick keeps page 0 — it does not select the hidden one and it
            // does not fall through to nothing.
            expect(displayed(tree)).toStrictEqual([0]);
        });
    });

    await describe('AdwViewStack on React Native — the tree it emits', async () => {
        await it('mounts every page and displays only the selected one', async () => {
            const tree = mounted(<AdwViewStack pages={PAGES.slice(0, 2)} />);
            const bodies = childrenOf(tree);
            expect(bodies.length).toBe(2);
            expect(at(bodies, 0).props.style).toStrictEqual({ flex: 1 });
            expect(at(bodies, 1).props.style).toStrictEqual({ display: 'none' });
            // The hidden page is MOUNTED, carrying its own body — a stack that rendered
            // only the selected page would lose the others' state on every switch.
            expect(textOf(onlyChild(at(bodies, 1)))).toBe('detail');
        });

        await it('reports the name it settled on when the selection moves', async () => {
            const seen: string[] = [];
            const stack = (name: string) => (
                <AdwViewStack pages={PAGES} visibleChildName={name} onNotifyVisibleChild={(n) => seen.push(n)} />
            );
            // MOUNTED ON A PAGE THAT IS NOT THE AUTO-PICK, on purpose: an authored name
            // equal to the auto-pick would make this row pass whether the initial
            // selection happened before the subscription or after it. `settings` is page
            // 2, so a selection made in the effect instead would arrive as a notification.
            const renderer = mount(stack('settings'));
            expect(shownName(renderer.toJSON() as ReturnType<typeof mounted>)).toBe('settings');
            expect(seen).toStrictEqual([]);
            act(() => {
                renderer.update(stack('home'));
            });
            expect(seen).toStrictEqual(['home']);
            act(() => {
                renderer.update(stack('nowhere'));
            });
            // Refused, so nothing moved and nothing was reported — a renderer that echoed
            // the prop back would report a name it is not showing.
            expect(seen).toStrictEqual(['home']);
        });
    });
};
