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
// stack. `@gjsify/adwaita-web` has the same problem and solves it the other way round,
// because a DOM node survives a re-render and a React element does not.
//
// AND THE TOKEN IS KEYED BY THE CHILD'S KEY, NOT BY ITS POSITION IN THE DECLARED LIST.
// `Children.toArray` COMPACTS: a `{cond && <Page/>}` branch that goes false is dropped
// from the array, so every page after it moves down one index. Measured with a
// position-keyed token, on the exact case this widget is for — three declared pages,
// `push('settings')`, then the root conditionally removed: the sync effect unregistered
// the LAST token instead of the vanished one, the survivors were retagged with their
// neighbours' tags, the visible token no longer resolved to an element, and the view
// rendered with EVERY page `display: 'none'` — a blank screen at exit 0, which is the
// failure signature this package exists to remove. The key does not move: `toArray`
// stamps `.$<key>` on an authored one and `.N` on an unkeyed child where N is the index
// in the ORIGINAL child list, holes included (measured: `[a, false, c]` yields
// `['.1', '.2']`, not `['.0', '.1']`).
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

/** A declared page's identity, allocated once per key and never re-created. */
interface PageToken {
    /** The key `Children.toArray` stamped on the child — see the head of this file. */
    readonly key: string;
    /**
     * The element last declared for this page.
     *
     * KEPT ON THE TOKEN so a page that stops being declared while it is still on the
     * stack goes on rendering until it is popped. That is `remove_page`'s own rule —
     * `NavigationViewState.remove` defers the unregistration for a page on the stack, as
     * `adw_navigation_view_remove` does — and looking the element up in the current
     * declared list instead would draw nothing for exactly those pages.
     */
    element: ReactElement<AdwNavigationPageProps>;
}

/**
 * The key `Children.toArray` gave this child.
 *
 * A LOUD FAILURE rather than a fallback: two pages sharing a synthesised key would share
 * a token, and the view would then lose one of them somewhere far from here. `toArray`
 * keys every child it returns, so this throw is unreachable — and the type is
 * `string | null`, so leaving it to `??` would be the silent version.
 */
function keyOf(element: ReactElement): string {
    if (element.key === null) throw new Error('Children.toArray returned a page with no key');
    return element.key;
}

/** The three headless page properties, off the element's own props. */
function corePropsOf(element: ReactElement<AdwNavigationPageProps>): CoreNavigationPageProps {
    return {
        tag: element.props.tag ?? null,
        title: element.props.title ?? '',
        canPop: element.props.canPop ?? true,
    };
}

/** What survives every render: the stack machine and one token per declared key. */
interface PageStore {
    state: NavigationViewState<PageToken>;
    tokens: Map<string, PageToken>;
}

/** {@link import('./navigation-view.js').AdwNavigationView} on React Native. */
export function AdwNavigationView({
    children,
    animateTransitions,
    popOnEscape,
    ref,
}: AdwNavigationViewProps): ReactElement | null {
    // `Children.toArray` flattens fragments and drops `null`/`false` branches — the
    // DROP is why a token is keyed rather than indexed; see the head of this file.
    const declared = Children.toArray(children).filter((child) =>
        isValidElement(child),
    ) as ReactElement<AdwNavigationPageProps>[];

    const [, repaint] = useState(0);
    const store = useRef<PageStore | null>(null);
    if (store.current === null) {
        const state = new NavigationViewState<PageToken>();
        const tokens = new Map<string, PageToken>();
        for (const element of declared) {
            const token: PageToken = { key: keyOf(element), element };
            tokens.set(token.key, token);
            state.add(token, corePropsOf(element));
        }
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
        const stillDeclared = new Set<string>();
        for (const element of declared) {
            const key = keyOf(element);
            stillDeclared.add(key);
            const existing = tokens.get(key);
            if (existing === undefined) {
                const token: PageToken = { key, element };
                tokens.set(key, token);
                state.add(token, corePropsOf(element));
                continue;
            }
            existing.element = element;
            const props = corePropsOf(element);
            state.setTag(existing, props.tag ?? null);
            state.setTitle(existing, props.title ?? '');
            state.setCanPop(existing, props.canPop ?? true);
        }
        // Iterated over a COPY: this loop deletes from the same map it walks, and
        // `state.remove` can unregister immediately on top of that.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the point: a live Map iterator would skip an entry after the delete below
        for (const [key, token] of [...tokens]) {
            if (stillDeclared.has(key)) continue;
            tokens.delete(key);
            state.remove(token);
        }
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
            {state.pages.map((token) => (
                <View key={token.key} style={token === visible ? { flex: 1 } : { display: 'none' }}>
                    {token.element}
                </View>
            ))}
        </View>
    );
}
