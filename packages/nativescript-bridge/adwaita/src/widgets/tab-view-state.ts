// AdwTabView's NativeScript-specific half — the parts that are not the model.
//
// The model (the ordered page list with its pinned prefix, the selection guards, the
// parent-aware close successor, the two-phase close protocol, the partition-clamped
// insert/reorder rules and the wrap-around cycling) is HEADLESS in
// `@gjsify/adwaita-core` as `TabViewState` (ADR 0004), shared with
// `@gjsify/adwaita-web` and pinned by the conformance vectors. NativeScript-specific
// is only how the model becomes pixels: NS has no page stack, so pages overlay in a
// `GridLayout` and swap by toggling `visibility`, and a tab's close button is shown or
// collapsed rather than faded.
//
// TYPE-only imports from `@nativescript/core`, so this module is unit-testable
// off-device; `adw-tab-view.ts` cannot be, because `extends GridLayout` evaluates the
// bare specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-tab-view.c (Adw.TabView)
// Reference: refs/libadwaita/src/adw-tab-bar.c (Adw.TabBar autohide)
// Reference: refs/libadwaita/src/adw-tab.c (AdwTab close button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { TabViewState, tabCloseVisible, tabTooltip, tabsRevealed } from '@gjsify/adwaita-core';
import type { AdwTabPageState, TabViewHandlers, TabViewSelectionChange } from '@gjsify/adwaita-core';

/** One page of an `AdwTabView`, as a renderer reads it. */
export type AdwTabPage = AdwTabPageState<View>;

/** The two `View.visibility` values a stacked page or a tab affordance ever takes. */
export type NsVisibility = 'visible' | 'collapse';

/** The model an `AdwTabView` delegates to, typed on the NS `View`. */
export function createTabViewState(handlers?: TabViewHandlers<View>): TabViewState<View> {
    return new TabViewState<View>(handlers);
}

/**
 * The `visibility` each page's content view must carry for the current selection, in
 * page order. Exactly one entry is `'visible'` — none when nothing is selected, which
 * is a real state: closing the last tab EMPTIES the view.
 */
export function tabPageVisibilities(state: TabViewState<View>): NsVisibility[] {
    const selected = state.selectedIndex;
    return state.pages.map((_page, index) => (index === selected ? 'visible' : 'collapse'));
}

/** Push {@link tabPageVisibilities} onto the real content views. */
export function applyTabViewVisibility(state: TabViewState<View>): void {
    const visibilities = tabPageVisibilities(state);
    state.pages.forEach((page, index) => {
        if (page.content) page.content.visibility = visibilities[index]!;
    });
}

/**
 * The `visibility` each tab's close button must carry, in page order.
 *
 * `tabCloseVisible` is `(hovering && fullyVisible) || selected || dragging`, and never
 * on a pinned tab. Touch has no hover and this port has no tab drag-and-drop, so both
 * are constantly false and the predicate REDUCES to "selected, and not pinned" —
 * called rather than written out so it stays a derivation.
 */
export function tabCloseVisibilities(state: TabViewState<View>): NsVisibility[] {
    const selected = state.selectedId;
    return state.pages.map((page) =>
        tabCloseVisible({
            hovering: false,
            fullyVisible: true,
            selected: page.id === selected,
            dragging: false,
            pinned: page.pinned,
        })
            ? 'visible'
            : 'collapse',
    );
}

/** The `visibility` of the whole tab bar — `tabsRevealed` projected onto NS. */
export function tabBarVisibility(state: TabViewState<View>, autohide: boolean): NsVisibility {
    return tabsRevealed({
        autohide,
        nPages: state.nPages,
        nPinnedPages: state.nPinnedPages,
        // Tab transfer between views is drag-and-drop; this port has none.
        isTransferringPage: false,
    })
        ? 'visible'
        : 'collapse';
}

/**
 * The text a tab's label shows. A pinned tab is a single-glyph chip in libadwaita —
 * `adw_tab_constructed` hides its title outright — so it renders no label here either.
 * Everything else shows its title, which the model has already coerced to `''` for a
 * page that declared none.
 */
export function tabLabelText(page: AdwTabPage): string {
    return page.pinned ? '' : page.title;
}

/**
 * The tooltip text for a tab — the page's own tooltip when it has one, its title
 * otherwise. NS has no tooltip primitive, so this is exposed for a consumer (and the
 * accessibility label) rather than rendered, and in TEXT form: a page-supplied tooltip
 * is Pango markup in C and NS has no markup sink.
 */
export function tabTooltipText(page: AdwTabPage): string {
    return tabTooltip(page);
}

/** The data half of the `notify::selected-page` event (minus NS's `eventName`/`object`). */
export interface TabViewNotifyPayload {
    /** Id of the newly-selected page, `null` when the view is empty. */
    selectedId: string | null;
    /** Its index, `-1` when the view is empty. */
    selectedIndex: number;
    /** The previously-selected id, `null` when there was none. */
    previousId: string | null;
    /** `false` for a model-driven pick (auto-select, close successor), `true` otherwise. */
    interactive: boolean;
}

/**
 * Project a core change onto the event payload. A function rather than a spread so a
 * live model object cannot leak into an event a consumer holds on to.
 */
export function tabViewNotifyPayload(change: TabViewSelectionChange): TabViewNotifyPayload {
    return {
        selectedId: change.selectedId,
        selectedIndex: change.selectedIndex,
        previousId: change.previousId,
        interactive: change.interactive,
    };
}
