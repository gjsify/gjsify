// The DOM half of the view-switcher family — what `@gjsify/adwaita-core` cannot
// decide because it is genuinely per-renderer.
//
// Everything that decides WHAT a switcher shows (the button-visibility rule, the
// `image-missing` fallback, the badge label + screen-reader description, the
// mnemonic-stripped label, the tooltip, the reveal gate, the two index spaces)
// lives in `@gjsify/adwaita-core` and is pinned by the conformance vectors.
// What is left, and lives here, is how a derived model becomes nodes: an icon
// NAME turned into a CSS mask class, an indicator span, and a `setTimeout`
// wrapped in the scheduler seam the core takes for the drag-hover dwell.
//
// Shared by `<adw-view-switcher>`, `<adw-inline-view-switcher>` and
// `<adw-view-switcher-bar>`, so their icon nodes and page parsing cannot drift apart.
//
// Reference: refs/libadwaita/src/adw-view-switcher.c
// Reference: refs/libadwaita/src/adw-indicator-bin.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented for @gjsify/adwaita-web Web Components.

import { viewSwitcherIconName } from '@gjsify/adwaita-core';
import type { AdwViewSwitcherPageInit, ViewSwitcherScheduler, ViewSwitcherTimerHandle } from '@gjsify/adwaita-core';

import { type GtkImage, createGtkImage } from './gtk-image.js';

/**
 * The browser's timer behind the core's scheduler seam. One shared instance rather than
 * one per element: it holds no state, and the seam exists so the CORE stays free of a
 * global timer, not so each element invents its own.
 */
export const domViewSwitcherScheduler: ViewSwitcherScheduler = {
    schedule(callback: () => void, ms: number): ViewSwitcherTimerHandle {
        return setTimeout(callback, ms);
    },
    cancel(handle: ViewSwitcherTimerHandle): void {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
};

/**
 * Build a switcher button's icon node, carrying its own position class.
 *
 * The core resolves NULL/empty to `image-missing` (which the stylesheet carries
 * a real glyph for); the `-symbolic` strip and the CSS-token guard are
 * `normalizeIconName`'s, applied by `<gtk-image>` — that strip is this package's
 * own mask-class convention and has no counterpart in C, where the name reaches
 * `GtkImage` untouched.
 */
export function createSwitcherIcon(iconName: string, extra: string): GtkImage {
    return createGtkImage(viewSwitcherIconName(iconName), extra);
}

/** Repaint an existing switcher icon from a page's declared name. */
export function applySwitcherIcon(icon: GtkImage, iconName: string): void {
    icon.iconName = viewSwitcherIconName(iconName);
}

/**
 * Read a declared page element into the core's page init.
 *
 * `getAttribute` returns `null` for an absent attribute, which is EXACTLY C's NULL, so
 * values are passed through unchanged rather than defaulted to `''`. Do not add a
 * `?? ''`: once an absent title has become the empty string, "the page has no title" is
 * no longer expressible and the button-visibility rule cannot be implemented.
 */
export function readSwitcherPage(element: Element): AdwViewSwitcherPageInit {
    const badge = Number.parseInt(element.getAttribute('badge-number') ?? '', 10);
    return {
        // A page with no `name` is the page named '', as in `<adw-view-stack>`: C stores
        // the name verbatim, and an invented `page-<index>` would be addressable by a
        // name the author never wrote.
        name: element.getAttribute('name') ?? '',
        title: element.getAttribute('title'),
        iconName: element.getAttribute('icon-name'),
        // `hidden` is the DOM spelling of AdwViewStackPage:visible.
        visible: !element.hasAttribute('hidden'),
        useUnderline: element.hasAttribute('use-underline'),
        badgeNumber: Number.isNaN(badge) ? 0 : badge,
        needsAttention: element.hasAttribute('needs-attention'),
    };
}

/**
 * Paint `AdwIndicatorBin`'s badge/dot onto a span: the badge text when there is
 * one, a bare dot when only `needs-attention` is set, nothing otherwise — C's
 * `AdwIndicatorBin` plus the `.needs-attention` style class.
 */
export function applyIndicator(indicator: HTMLElement, badgeLabel: string, needsAttention: boolean): void {
    indicator.textContent = badgeLabel;
    indicator.classList.toggle('needs-attention', needsAttention && badgeLabel.length === 0);
    indicator.hidden = badgeLabel.length === 0 && !needsAttention;
}

/**
 * Mirror the derived screen-reader description onto the element, REMOVING the
 * attribute when there is none — `update_description_cb` resets the accessible
 * property rather than setting it to `""`.
 */
export function applyDescription(element: HTMLElement, description: string): void {
    if (description) element.setAttribute('aria-description', description);
    else element.removeAttribute('aria-description');
}
