// The view switchers' NativeScript-specific half — the parts that are not the
// derivation.
//
// Everything that decides WHAT a switcher shows lives in `@gjsify/adwaita-core` (ADR
// 0004), pinned by the conformance vectors. What lives HERE is how a derived model
// becomes pixels: NS has no page stack, so pages overlay in a `GridLayout` and swap by
// toggling `visibility`, and an icon is a raw Adwaita SVG document rather than a name.
// TYPE-only `@nativescript/core` imports, so specs run off-device (AGENTS.md).
//
// Reference: refs/libadwaita/src/adw-view-switcher.c
// Reference: refs/libadwaita/src/adw-view-switcher-bar.c
// Reference: refs/libadwaita/src/adw-inline-view-switcher.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { imageMissingSymbolic } from '@gjsify/adwaita-icons/status';
import { VIEW_SWITCHER_FALLBACK_ICON, ViewSwitcherBarState, ViewSwitcherState } from '@gjsify/adwaita-core';
import type { AdwViewSwitcherPageInit, ViewSwitcherStateChange } from '@gjsify/adwaita-core';

/**
 * One page registered with a view switcher.
 *
 * Mirrors `AdwViewStackPage`'s properties with their C defaults. `title` and
 * `icon` are NULLABLE on purpose: a page with neither renders no button at all, and
 * an absent title flattened to `''` makes that rule inexpressible.
 *
 * `icon` is an Adwaita symbolic SVG DOCUMENT here, not a GTK icon name: `GtkImage`
 * rasterises the path data natively. The core treats the field as an opaque
 * handle and only ever interprets "absent or empty"; {@link nsIconSvg} resolves
 * the fallback sentinel it hands back.
 */
export interface AdwViewPage {
    /** The switcher button label. ABSENT is C's NULL — the state button visibility turns on. */
    title?: string;
    /** The page content view, shown when this page is selected. */
    content: View;
    /** Adwaita symbolic SVG shown on the switcher button; absent means none. */
    icon?: string;
    /** Stable id used by `visible-child-name`; defaults to the page's position. */
    name?: string;
    /** `AdwViewStackPage:visible` — default `true`. */
    visible?: boolean;
    /** `AdwViewStackPage:use-underline` — an `_` in the title marks a mnemonic. */
    useUnderline?: boolean;
    /** `AdwViewStackPage:badge-number` — default `0`. */
    badgeNumber?: number;
    /** `AdwViewStackPage:needs-attention` — default `false`. */
    needsAttention?: boolean;
}

/** The two `View.visibility` values a stacked page ever takes. */
export type NsPageVisibility = 'visible' | 'collapse';

/** The selection + page model a switcher delegates to. */
export function createViewSwitcherState(): ViewSwitcherState {
    return new ViewSwitcherState();
}

/** The reveal state machine an `AdwViewSwitcherBar` delegates to. */
export function createViewSwitcherBarState(): ViewSwitcherBarState {
    return new ViewSwitcherBarState();
}

/**
 * Project one NS page onto the core's page init.
 *
 * A page without an explicit `name` gets its POSITION as the name: the NS API is
 * positional (`setViews` takes an array), and the name-preserving rebuild needs a
 * stable id to keep the selected page selected.
 */
export function viewSwitcherPageSpec(page: AdwViewPage, index: number): AdwViewSwitcherPageInit {
    return {
        name: page.name ?? String(index),
        title: page.title ?? null,
        iconName: page.icon ?? null,
        visible: page.visible ?? true,
        useUnderline: page.useUnderline ?? false,
        badgeNumber: page.badgeNumber ?? 0,
        needsAttention: page.needsAttention ?? false,
    };
}

/** {@link viewSwitcherPageSpec} over a whole page list. */
export function viewSwitcherPageSpecs(pages: readonly AdwViewPage[]): AdwViewSwitcherPageInit[] {
    return pages.map((page, index) => viewSwitcherPageSpec(page, index));
}

/**
 * Resolve the core's icon slot to something `GtkImage` can rasterise.
 *
 * The core substitutes the NAME `image-missing` for an absent icon. On the browser
 * side that name becomes a CSS mask class; here it has to become the actual
 * symbolic document, so the sentinel is swapped for the vendored
 * `image-missing-symbolic` SVG. Anything else is already an SVG and passes through.
 */
export function nsIconSvg(iconName: string): string {
    return iconName === VIEW_SWITCHER_FALLBACK_ICON ? imageMissingSymbolic : iconName;
}

/**
 * The `visibility` each page's content view must carry for the current
 * selection, in page order. Exactly one entry is `'visible'` — none when nothing
 * is selected, which is a real state here (an empty switcher, or every page
 * hidden).
 */
export function pageVisibilities(pages: readonly AdwViewPage[], selected: number): NsPageVisibility[] {
    return pages.map((_page, index) => (index === selected ? 'visible' : 'collapse'));
}

/** Push {@link pageVisibilities} onto the real content views. */
export function applyViewSwitcherVisibility(pages: readonly AdwViewPage[], selected: number): void {
    const visibilities = pageVisibilities(pages, selected);
    pages.forEach((page, index) => {
        page.content.visibility = visibilities[index]!;
    });
}

/** Which switcher is asking — the two apply different visibility rules. */
export type ViewSwitcherKind = 'switcher' | 'inline';

/**
 * Whether a page gets a button/toggle at all. The two switchers genuinely differ:
 *
 * - `AdwViewSwitcher` needs a title or an icon ON TOP OF `visible`
 *   (`visible && (title != NULL || icon_name != NULL)`).
 * - `AdwInlineViewSwitcher` gates on `visible` alone, so a page with neither still
 *   gets an empty toggle.
 *
 * The rule lives here rather than in the widget because a class that `extends
 * GridLayout` cannot be imported by a spec.
 */
export function switcherButtonVisible(kind: ViewSwitcherKind, modelVisible: boolean, pageVisible: boolean): boolean {
    return kind === 'inline' ? pageVisible : modelVisible;
}

/** The data half of the `notify::selected` event (minus NS's `eventName`/`object`). */
export interface ViewSwitcherNotifyPayload {
    /** The newly-selected page index, `-1` when nothing is selected. */
    selected: number;
    /** Its name, `''` when nothing is selected. */
    name: string;
    /** Its painted label, `''` when nothing is selected. */
    title: string;
    /** `false` for an auto-pick (a rebuild, a visibility flip), `true` for a tap. */
    interactive: boolean;
}

/**
 * Project a core change onto the event payload. A function rather than a spread
 * so no live model object escapes into an event a consumer might hold on to.
 */
export function viewSwitcherNotifyPayload(change: ViewSwitcherStateChange): ViewSwitcherNotifyPayload {
    return {
        selected: change.selected,
        name: change.name,
        title: change.title,
        interactive: change.interactive,
    };
}
