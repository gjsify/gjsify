/** @jsxImportSource react */
// The React Native half of `AdwViewSwitcher`, rendered through React's real reconciler.
//
// WHAT IS ASSERTED IS THE DERIVATION, because that is the half both renderers share.
// `buildViewSwitcherButtons` decides whether a button exists at all, what its label
// reads after mnemonic stripping, what its badge reads above the limit and which way it
// arranges itself; libadwaita computes the same on GTK from the stack's pages model, and
// `navigation.gtk.spec.tsx` asserts that the real `Adw.ViewSwitcher` is pointed at the
// real `Adw.ViewStack` so those buttons are libadwaita's own.
//
// A HIDDEN BUTTON IS ASSERTED AS A NODE WITH `display: 'none'`, never as an absence: a
// missing node cannot tell "this page has no button" from "this page is not in the model
// at all", and the first is a C rule while the second would be a bug in this file.
//
// PRESSING IS ASSERTED THROUGH THE HANDLER THE TREE CARRIES, which is as far as a
// `react-test-renderer` tree goes: what a spec here can show is that the widget ASKS for
// a press and what it does when one arrives, never that a tap on a device reaches it.
// `testing/react-native.ts` carries that gap, and it is why the tap target is a `Text` —
// React Native's tappable primitives are composites the double may not stand in for.

import { describe, expect, it } from '@gjsify/unit';
import { act } from 'react-test-renderer';

import { VIEW_SWITCHER_BADGE_LIMIT } from '@gjsify/adwaita-core';

import { RCT_TEXT } from '../testing/react-native.js';
import { at, childrenOf, mount, mounted, textOf } from '../testing/render.spec.js';
import { AdwViewSwitcher } from './view-switcher.native.js';

const PAGES = [
    { name: 'home', title: 'Home' },
    { name: 'detail', title: 'Detail' },
];

/** The button row — always the switcher's first child, with the page bodies after it. */
function buttonRow(tree: ReturnType<typeof mounted>) {
    return childrenOf(at(childrenOf(tree), 0));
}

export default async () => {
    await describe('AdwViewSwitcher on React Native — the buttons it derives', async () => {
        await it('gives every page a button, above the page bodies', async () => {
            const tree = mounted(<AdwViewSwitcher pages={PAGES} />);
            // One row plus one body per page.
            expect(childrenOf(tree).length).toBe(3);
            const buttons = buttonRow(tree);
            expect(buttons.length).toBe(2);
            expect(textOf(at(childrenOf(at(buttons, 0)), 0))).toBe('Home');
            expect(at(childrenOf(at(buttons, 1)), 0).type).toBe(RCT_TEXT);
        });

        await it('strips the mnemonic marker libadwaita underlines', async () => {
            const tree = mounted(<AdwViewSwitcher pages={[{ name: 'home', title: '_Home', useUnderline: true }]} />);
            // `_Home` with `use-underline` is the label `Home` with H marked — a renderer
            // with no accelerator layer wants the plain text, and `stripMnemonic` is where
            // that lives.
            expect(textOf(at(childrenOf(at(buttonRow(tree), 0)), 0))).toBe('Home');
        });

        await it('hides the button of a page with NEITHER a title NOR an icon', async () => {
            const tree = mounted(<AdwViewSwitcher pages={[{ name: 'home', title: 'Home' }, { name: 'ghost' }]} />);
            const buttons = buttonRow(tree);
            // The node exists — the page is in the model — and is not displayed.
            expect(buttons.length).toBe(2);
            expect((at(buttons, 1).props.style as { display?: string }).display).toBe('none');
            // And an EMPTY title is NOT that case: `''` is not NULL, so it keeps a button.
            const empty = mounted(<AdwViewSwitcher pages={[{ name: 'home', title: '' }]} />);
            expect((at(buttonRow(empty), 0).props.style as { display?: string }).display).toBe('flex');
        });

        await it('caps the badge at 999+, and draws none at zero', async () => {
            const tree = mounted(
                <AdwViewSwitcher
                    pages={[
                        { name: 'home', title: 'Home', badgeNumber: VIEW_SWITCHER_BADGE_LIMIT + 1 },
                        { name: 'detail', title: 'Detail' },
                    ]}
                />,
            );
            const buttons = buttonRow(tree);
            expect(childrenOf(at(buttons, 0)).length).toBe(2);
            expect(textOf(at(childrenOf(at(buttons, 0)), 1))).toBe('999+');
            // Badge 0 is no badge at all — one child, not a child holding ''.
            expect(childrenOf(at(buttons, 1)).length).toBe(1);
        });

        await it('arranges the button along the axis the policy names', async () => {
            const narrow = mounted(<AdwViewSwitcher pages={PAGES} />);
            expect((at(buttonRow(narrow), 0).props.style as { flexDirection?: string }).flexDirection).toBe('column');
            const wide = mounted(<AdwViewSwitcher pages={PAGES} policy="wide" />);
            expect((at(buttonRow(wide), 0).props.style as { flexDirection?: string }).flexDirection).toBe('row');
        });
    });

    await describe('AdwViewSwitcher on React Native — pressing one', async () => {
        await it('switches the visible page and reports the name it moved to', async () => {
            const seen: string[] = [];
            const renderer = mount(<AdwViewSwitcher pages={PAGES} onNotifyVisibleChild={(n) => seen.push(n)} />);
            const tree = renderer.toJSON();
            if (tree === null || Array.isArray(tree)) throw new Error('the switcher rendered no single root');
            const label = at(childrenOf(at(buttonRow(tree), 1)), 0);
            act(() => {
                (label.props.onPress as () => void)();
            });
            expect(seen).toStrictEqual(['detail']);

            const after = renderer.toJSON();
            if (after === null || Array.isArray(after)) throw new Error('the switcher rendered no single root');
            const bodies = childrenOf(after).slice(1);
            expect((at(bodies, 0).props.style as { display?: string }).display).toBe('none');
            expect(at(bodies, 1).props.style).toStrictEqual({ flex: 1 });
            // The button that was pressed now reports itself selected — the model's own
            // flag, so a renderer that painted selection from its own memory would differ.
            expect((at(buttonRow(after), 1).props.accessibilityState as { selected?: boolean }).selected).toBe(true);
        });
    });
};
