/** @jsxImportSource react */
// `AdwNavigationView` on React Native — `@gjsify/adwaita-core`'s port of libadwaita's
// stack machine. (On the pragma, see `bin.native.tsx`.)
//
// WHERE THE STATE LIVES, AND WHY IT IS NOT IN REACT. `NavigationViewState` is in a
// `useRef` and is never re-created: it owns the page registry, the tag index, the
// static-versus-dynamic `remove_on_pop` lifecycle and the six mutators. Rebuilding it on
// a render would reset a stack the user had already pushed onto; putting it in
// `useState` would additionally make React decide when it exists. It is the authority,
// so it outlives every render — exactly as `Adw.NavigationView` does on the other half,
// where the authority is libadwaita's own C. Same reasoning, and the same shape, as
// `AdwToastQueue` in `toast-overlay.native.tsx`.
//
// REACT'S ONLY JOB IS THE REPAINT, which is what the `useState` counter is: the
// subscription bumps it, and the render reads the settled stack back out of the core.
// The subscription is installed in an EFFECT rather than beside the construction, and
// that ordering is load-bearing: the initial `add()` calls auto-push the root page and
// therefore EMIT, and a listener that called `setState` there would be updating a
// component while it renders.
//
// A PAGE'S IDENTITY IS A TOKEN, NOT ITS ELEMENT. `NavigationViewState<P>` keys its
// registry on `P` by identity, and React rebuilds every child element on every render —
// so registering the elements would re-register the whole view each time and lose the
// stack. The token is the page's position in the declared list, allocated once, and the
// CURRENT element for that position is looked up at render. `@gjsify/adwaita-web` has
// the same problem and solves it the other way round, because a DOM node survives a
// re-render and a React element does not.
//
// DECLARED CHILDREN ARE THE STATICALLY-ADDED PAGES, in order, and page 0 becomes visible
// with nobody pushing it: `add_page` auto-pushes whenever the stack is EMPTY. Both other
// renderers snapshot their declared children exactly this way — and the auto-push is
// also what re-arms the view after `replaceWithTags([])`.
//
// EVERY REGISTERED PAGE STAYS MOUNTED and the hidden ones are `display: 'none'`, which
// is `hidden` on the browser half and `visibility: 'collapse'` on the NativeScript one.
// Rendering only the visible page would unmount the rest and lose their component state
// on every push — a divergence from all three other renderers, on the widget whose whole
// point is that you can go back to where you were.
//
// THERE IS NO AUTOMATIC BACK BUTTON, which is `@gjsify/adwaita-nativescript`'s decision
// and for its reason: the browser renderer can find an `<adw-header-bar>` inside the page
// and inject one, and neither NativeScript nor this package has a header bar it can
// identify inside an opaque child. `canGoBack()` and `backButtonTooltip()` on the handle
// are the two derivations a caller wires its own button to, and they are libadwaita's
// own rules rather than this file's.

import { Children, isValidElement, useEffect, useImperativeHandle, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';

import { NavigationViewState, type AdwNavigationPageProps as CoreNavigationPageProps } from '@gjsify/adwaita-core';

import type { AdwNavigationPageProps, AdwNavigationViewProps } from '../props.js';

/** A declared page's identity, allocated once per position and never re-created. */
interface PageToken {
    /** Index into the declared child list — how the element for this page is found again. */
    readonly index: number;
}

/** The three headless page properties, off the element's own props. */
function corePropsOf(element: ReactElement<AdwNavigationPageProps>): CoreNavigationPageProps {
    return {
        tag: element.props.tag ?? null,
        title: element.props.title ?? '',
        canPop: element.props.canPop ?? true,
    };
}

/** What survives every render: the stack machine and one token per declared position. */
interface PageStore {
    state: NavigationViewState<PageToken>;
    tokens: PageToken[];
}

/** {@link import('./navigation-view.js').AdwNavigationView} on React Native. */
export function AdwNavigationView({
    children,
    animateTransitions,
    popOnEscape,
    ref,
}: AdwNavigationViewProps): ReactElement | null {
    // `Children.toArray` drops `null`/`false` branches and flattens fragments, so a
    // conditionally-rendered page does not shift the positions of the ones after it.
    const declared = Children.toArray(children).filter((child) =>
        isValidElement(child),
    ) as ReactElement<AdwNavigationPageProps>[];

    const [, repaint] = useState(0);
    const store = useRef<PageStore | null>(null);
    if (store.current === null) {
        const state = new NavigationViewState<PageToken>();
        const tokens = declared.map((_, index) => ({ index }));
        tokens.forEach((token, index) =>
            state.add(token, corePropsOf(declared[index] as ReactElement<AdwNavigationPageProps>)),
        );
        store.current = { state, tokens };
    }
    const { state, tokens } = store.current;

    useEffect(
        () =>
            state.subscribe(() => {
                // No animation on this half, so the deferred destroy settles at once —
                // what `adw_animation_skip` does in the C when `animate` is FALSE, and
                // what both other renderers call this seam for.
                state.finishTransition();
                repaint((count) => count + 1);
            }),
        [state],
    );

    // The web half's `syncPageProperty`: the props are the authoring surface, and the
    // tag index, the title chain and the back-button rule read the CORE's copy. Without
    // this, a page's `can-pop` would be frozen at whatever it was when the view mounted.
    // No dependency list — the declared list is rebuilt on every render, so any
    // dependency over it would be a second copy of the same three values.
    useEffect(() => {
        state.setAnimateTransitions(animateTransitions ?? true);
        state.setPopOnEscape(popOnEscape ?? true);
        while (tokens.length < declared.length) {
            const token: PageToken = { index: tokens.length };
            tokens.push(token);
            state.add(token, corePropsOf(declared[token.index] as ReactElement<AdwNavigationPageProps>));
        }
        while (tokens.length > declared.length) {
            state.remove(tokens.pop() as PageToken);
        }
        declared.forEach((element, index) => {
            const token = tokens[index];
            if (token === undefined) return;
            const props = corePropsOf(element);
            state.setTag(token, props.tag ?? null);
            state.setTitle(token, props.title ?? '');
            state.setCanPop(token, props.canPop ?? true);
        });
    });

    useImperativeHandle(
        ref,
        () => ({
            // `pushByTag` returns a boolean here and `adw_navigation_view_push_by_tag`
            // returns void, so the boolean is dropped rather than widening the surface
            // past what both halves can answer.
            push: (tag: string): void => {
                state.pushByTag(tag);
            },
            pop: (): boolean => state.pop(),
            popToTag: (tag: string): boolean => state.popToTag(tag),
            replaceWithTags: (tags: readonly string[]): void => state.replaceWithTags(tags),
            visiblePageTag: (): string | null => state.visiblePageTag,
            canGoBack: (): boolean => state.canGoBack(),
            backButtonTooltip: (): string | null => state.backButtonTooltip(),
        }),
        [state],
    );

    const visible = state.visiblePage;
    return (
        <View style={{ flex: 1 }}>
            {state.pages.map((token) => {
                const element = declared[token.index];
                if (element === undefined) return null;
                return (
                    <View key={token.index} style={token === visible ? { flex: 1 } : { display: 'none' }}>
                        {element}
                    </View>
                );
            })}
        </View>
    );
}
