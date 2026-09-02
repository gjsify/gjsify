/** @jsxImportSource react */
// The React Native half of `AdwNavigationView`, rendered through React's real reconciler.
//
// EVERY TAG AND EVERY TOOLTIP IN THIS FILE HAS A TWIN IN `navigation.gtk.spec.tsx`, run
// against libadwaita's own stack instead of `@gjsify/adwaita-core`'s port of it. That is
// what "one API surface, two implementations" has to mean on a widget whose state is a
// stack rather than a number: not that both files compile, but that a three-page chain
// answers `home` / `detail` / `Home` / `Back` identically on a desktop and on a phone.
//
// ONE ROW IS ASSERTED HERE AND NOT THERE, and it is a measurement rather than a gap. The
// `'Back'` fallback needs a page whose title is EMPTY, and libadwaita 1.9.3 prints
// `AdwNavigationPage 0x… is missing a title.` for exactly that page — a diagnostic the
// GTK suite's `installDiagnosticsGate` fails on, and correctly. Both halves still share
// the STRING: `BACK_BUTTON_FALLBACK_TOOLTIP` is what `navigation-view.gtk.tsx` falls back
// to and what `NavigationViewState.backButtonTooltip` defaults to.
//
// WHAT IS AND IS NOT MEASURED. `react-test-renderer` runs React's own reconciler and hook
// dispatcher, so the effects that register the pages and the `useImperativeHandle` that
// exposes the stack are real. What is absent is Yoga: `display: 'none'` is an INSTRUCTION
// to a layout engine that is not in this process, so "the other pages are hidden" is
// asserted as what the widget ASKS FOR.

import { describe, expect, it } from '@gjsify/unit';
import { act } from 'react-test-renderer';

import { BACK_BUTTON_FALLBACK_TOOLTIP } from '@gjsify/adwaita-core';

import type { AdwNavigationViewHandle } from '../props.js';
import { RCT_VIEW } from '../testing/react-native.js';
import { at, childrenOf, mount, type Style } from '../testing/render.spec.js';
import { AdwNavigationPage } from './navigation-page.native.js';
import { AdwNavigationView } from './navigation-view.native.js';

/** The three declared pages `navigation.gtk.spec.tsx` uses, with one title left empty. */
function pages() {
    return [
        <AdwNavigationPage key="home" title="Home" tag="home">
            {null}
        </AdwNavigationPage>,
        <AdwNavigationPage key="detail" title="Detail" tag="detail">
            {null}
        </AdwNavigationPage>,
        <AdwNavigationPage key="settings" title="Settings" tag="settings">
            {null}
        </AdwNavigationPage>,
    ];
}

/** Mount the three-page view and hand back its handle plus a reader for the tree. */
function mountView(options: { detailCanPop?: boolean; untitledRoot?: boolean } = {}) {
    const ref: { current: AdwNavigationViewHandle | null } = { current: null };
    const declared = pages();
    const renderer = mount(
        <AdwNavigationView ref={ref}>
            {options.untitledRoot ? (
                <AdwNavigationPage key="home" title="" tag="home">
                    {null}
                </AdwNavigationPage>
            ) : (
                declared[0]
            )}
            <AdwNavigationPage key="detail" title="Detail" tag="detail" canPop={options.detailCanPop}>
                {null}
            </AdwNavigationPage>
            {declared[2]}
        </AdwNavigationView>,
    );
    if (ref.current === null) throw new Error('the view exposed no handle');
    return { handle: ref.current, renderer };
}

/** Which declared page the tree is showing, by the style the wrappers carry. */
function displayedIndexes(renderer: ReturnType<typeof mount>): number[] {
    const tree = renderer.toJSON();
    if (tree === null || Array.isArray(tree)) throw new Error('the view rendered no single root');
    return childrenOf(tree)
        .map((child, index) => ((child.props.style as { display?: string }).display === undefined ? index : -1))
        .filter((index) => index >= 0);
}

export default async () => {
    await describe('AdwNavigationView on React Native — the tree it emits', async () => {
        await it('keeps every registered page mounted and shows exactly one', async () => {
            const { renderer } = mountView();
            const tree = renderer.toJSON();
            if (tree === null || Array.isArray(tree)) throw new Error('the view rendered no single root');
            expect(tree.type).toBe(RCT_VIEW);
            // Three pages in the tree, and only page 0 displayed — the auto-push.
            expect(childrenOf(tree).length).toBe(3);
            expect(displayedIndexes(renderer)).toStrictEqual([0]);
            expect(at(childrenOf(tree), 0).props.style as Style).toStrictEqual({ flex: 1 });
            expect(at(childrenOf(tree), 1).props.style as Style).toStrictEqual({ display: 'none' });
        });

        await it('moves the displayed page on a push, without unmounting the others', async () => {
            const { handle, renderer } = mountView();
            act(() => handle.push('settings'));
            expect(displayedIndexes(renderer)).toStrictEqual([2]);
            const tree = renderer.toJSON();
            if (tree === null || Array.isArray(tree)) throw new Error('the view rendered no single root');
            // STILL three: a renderer that dropped the hidden pages would lose their
            // component state on every push, which no other Adwaita renderer does.
            expect(childrenOf(tree).length).toBe(3);
        });
    });

    await describe('AdwNavigationView on React Native — the stack machine both halves answer alike', async () => {
        await it('starts on the root page, with no way back', async () => {
            const { handle } = mountView();
            expect(handle.visiblePageTag()).toBe('home');
            expect(handle.canGoBack()).toBe(false);
            expect(handle.backButtonTooltip()).toBe(null);
        });

        await it('pushes by tag and names the revealed page in the tooltip', async () => {
            const { handle } = mountView();
            act(() => handle.push('detail'));
            expect(handle.visiblePageTag()).toBe('detail');
            expect(handle.canGoBack()).toBe(true);
            // The title of the page the button would REVEAL, not of the one on screen.
            expect(handle.backButtonTooltip()).toBe('Home');
        });

        await it('pops back to the root and refuses to pop the root', async () => {
            const { handle } = mountView();
            act(() => handle.push('detail'));
            let popped = false;
            act(() => {
                popped = handle.pop();
            });
            expect(popped).toBe(true);
            expect(handle.visiblePageTag()).toBe('home');
            expect(handle.pop()).toBe(false);
        });

        await it('replaces the whole stack, last tag visible', async () => {
            const { handle } = mountView();
            act(() => handle.replaceWithTags(['home', 'detail', 'settings']));
            expect(handle.visiblePageTag()).toBe('settings');
            act(() => {
                handle.popToTag('home');
            });
            expect(handle.visiblePageTag()).toBe('home');
        });

        await it('hides the back button for a page that cannot be popped', async () => {
            const { handle } = mountView({ detailCanPop: false });
            act(() => handle.push('detail'));
            expect(handle.visiblePageTag()).toBe('detail');
            // `can-pop` gates the BUTTON and the shortcuts, never `pop()`.
            expect(handle.canGoBack()).toBe(false);
            expect(handle.backButtonTooltip()).toBe(null);
            let popped = false;
            act(() => {
                popped = handle.pop();
            });
            expect(popped).toBe(true);
        });

        await it('falls back to “Back” when the revealed page has an empty title', async () => {
            const { handle } = mountView({ untitledRoot: true });
            act(() => handle.push('detail'));
            // The constant, not the literal: `navigation-view.gtk.tsx` imports the same
            // one, so the two halves cannot drift apart on the string.
            expect(handle.backButtonTooltip()).toBe(BACK_BUTTON_FALLBACK_TOOLTIP);
            expect(BACK_BUTTON_FALLBACK_TOOLTIP).toBe('Back');
        });
    });
};
