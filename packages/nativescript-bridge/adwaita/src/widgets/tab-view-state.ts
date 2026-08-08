// AdwTabView's NativeScript-specific half — the parts that are not the model.
//
// The model itself (the ordered page list with its pinned prefix, the selection
// guards, the parent-aware close successor, the two-phase close protocol, the
// partition-clamped insert/reorder rules and the wrap-around cycling) is
// HEADLESS and lives in `@gjsify/adwaita-core` as `TabViewState` (ADR 0004),
// shared with `@gjsify/adwaita-web` and pinned by the conformance vectors. What
// is NativeScript-specific is only how that model becomes pixels: NS has no page
// stack, so pages overlay in a `GridLayout` and swap by toggling `visibility`
// between `visible` and `collapse`, and a tab's close button is shown or
// collapsed rather than faded.
//
// This module imports only TYPES from `@nativescript/core` — like
// `icon-path.ts`, `row-press.ts`, `avatar-color.ts` and `view-stack-state.ts` —
// so it carries no runtime `@nativescript/core` value import and loads, and is
// unit-testable, off-device. `adw-tab-view.ts` cannot serve that role: it
// `extends GridLayout`, which evaluates the bare specifier at module-eval and is
// unresolvable on GJS/Node.
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
 * The `visibility` each page's content view must carry for the current
 * selection, in page order. Exactly one entry is `'visible'` — none when nothing
 * is selected, which is a real state here: closing the last tab EMPTIES the view
 * (adw-tab-view.c:1912-1913), where the old port refused the close outright.
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
 * `tabCloseVisible` is `(hovering && fullyVisible) || selected || dragging`, and
 * never on a pinned tab (adw-tab.c:124, :645-650). Touch has no hover and this
 * port has no tab drag-and-drop, so `hovering` and `dragging` are constantly
 * false and the predicate REDUCES to "selected, and not pinned" — which is the
 * old port's rule plus the pinned gate it was missing. Calling the shared
 * predicate rather than writing `active` keeps that a derivation instead of a
 * coincidence, and gives the pinned gate for free.
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

/**
 * The `visibility` of the whole tab bar — `tabsRevealed` (adw-tab-bar.c:142-164)
 * projected onto NS. The old port had no autohide at all; the bar was added in
 * the constructor and never hidden.
 */
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
 * The text a tab's label shows.
 *
 * A pinned tab is a single-glyph chip in libadwaita — `adw_tab_constructed`
 * hides its title outright (adw-tab.c:645-650) — so it renders no label at all
 * here either. Everything else shows its title, which is already `''` rather
 * than `undefined` for a page that declared none: the old port assigned
 * `page.title` straight to `Label.text` with no coercion, so an `AdwViewPage`
 * literal without a title rendered the string "undefined".
 */
export function tabLabelText(page: AdwTabPage): string {
    return page.pinned ? '' : page.title;
}

/**
 * The tooltip text for a tab — `tabTooltip`, i.e. the page's own tooltip when it
 * has one and its title otherwise (adw-tab.c:137-146).
 *
 * NS has no tooltip primitive, so this is exposed for a consumer (and for the
 * accessibility label) rather than rendered. It is deliberately the TEXT form:
 * a page-supplied tooltip is Pango markup in C, and NS has no markup sink to
 * push it through.
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
 * Project a core change onto the event payload. Kept as a function rather than
 * spreading the change directly so that if the core payload ever grows a live
 * model object, it does not silently leak into an event a consumer holds on to.
 */
export function tabViewNotifyPayload(change: TabViewSelectionChange): TabViewNotifyPayload {
    return {
        selectedId: change.selectedId,
        selectedIndex: change.selectedIndex,
        previousId: change.previousId,
        interactive: change.interactive,
    };
}
