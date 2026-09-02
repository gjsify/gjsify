/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwNavigationView` on GTK — the real `Adw.NavigationView`, and libadwaita's own
// stack. (On the pragma, see `bin.gtk.tsx`.)
//
// `NavigationViewState` IS NOT USED HERE, and that is the design rather than an
// omission — the same rule `clamp.gtk.tsx` states for `clampAllocate` and
// `toast-overlay.gtk.tsx` for `AdwToastQueue`. The core's port of the stack machine
// exists for a renderer with no libadwaita; this half has the original, and running
// both would give one widget two authorities for which page is on top. The core's value
// on this path is as the oracle `navigation-view.native.spec.tsx` is measured against.
//
// TWO CONSTANTS ARE STILL SHARED, because they are not a second computation: the
// back-button DERIVATION below is libadwaita's own rule (`adw-back-button.c`'s
// `update_page` and `query_tooltip`) read off the real widget, and the fallback string
// it lands on is `BACK_BUTTON_FALLBACK_TOOLTIP` — the same constant the React Native
// half's `backButtonTooltip()` defaults to. Retyping `'Back'` here would be the drift.
//
// THE MUTATORS ARE CALLS, REACHED THROUGH A `ref`, for the reason `props.ts` gives:
// `Adw.NavigationView:visible-page` is READ-ONLY and `push`/`pop` are methods, so a
// prop-driven stack would be this package inventing a shape libadwaita does not have.
// gtk-host's `getPublicInstance` hands back the author's own widget, so the ref is the
// real `Adw.NavigationView`.

import type Adw from 'gi://Adw?version=1';
import { useImperativeHandle, useRef, type ReactElement } from 'react';

import { BACK_BUTTON_FALLBACK_TOOLTIP } from '@gjsify/adwaita-core';

import type { AdwNavigationViewProps } from '../props.js';

/**
 * `AdwBackButton`'s visibility rule, read off the live widget.
 *
 * `get_previous_page(visible) !== null && visible.can_pop` — the ONLY place `can-pop`
 * decides anything, and deliberately not `get_navigation_stack().n_items > 1`: the
 * stack is a `Gio.ListModel`, so that spelling would pull a second typelib into this
 * module for a question two calls already answer.
 */
function canGoBack(view: Adw.NavigationView | null): boolean {
    const page = view?.get_visible_page() ?? null;
    if (view === null || page === null || !page.canPop) return false;
    return view.get_previous_page(page) !== null;
}

/** `AdwBackButton`'s `query_tooltip`: the revealed page's title, or the fallback. */
function backButtonTooltip(view: Adw.NavigationView | null): string | null {
    if (!canGoBack(view) || view === null) return null;
    const previous = view.get_previous_page(view.get_visible_page() as Adw.NavigationPage);
    if (previous === null) return null;
    return previous.title.length > 0 ? previous.title : BACK_BUTTON_FALLBACK_TOOLTIP;
}

/** {@link import('./navigation-view.js').AdwNavigationView} on GTK. */
export function AdwNavigationView({
    children,
    animateTransitions,
    popOnEscape,
    ref,
}: AdwNavigationViewProps): ReactElement | null {
    const view = useRef<Adw.NavigationView | null>(null);

    useImperativeHandle(
        ref,
        () => ({
            push: (tag: string): void => view.current?.push_by_tag(tag),
            pop: (): boolean => view.current?.pop() ?? false,
            popToTag: (tag: string): boolean => view.current?.pop_to_tag(tag) ?? false,
            // A COPY, because `replace_with_tags` takes a mutable `string[]` through the
            // introspection binding and the prop is a `readonly string[]`.
            replaceWithTags: (tags: readonly string[]): void => view.current?.replace_with_tags([...tags]),
            visiblePageTag: (): string | null => view.current?.get_visible_page_tag() ?? null,
            canGoBack: (): boolean => canGoBack(view.current),
            backButtonTooltip: (): string | null => backButtonTooltip(view.current),
        }),
        [],
    );

    return (
        <adw-navigation-view ref={view} animate-transitions={animateTransitions} pop-on-escape={popOnEscape}>
            {children}
        </adw-navigation-view>
    );
}
