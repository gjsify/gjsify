// The tab chip — one button in an AdwTabBox — and the two measurements that hang off
// it, shared by the two widgets that render one.
//
// WHY A SHARED MODULE. `<adw-tab-bar>` is libadwaita's tab bar as a widget of its own,
// and `<adw-tab-view>` has carried a merged one since before that existed. Both draw the
// SAME chip — the same five nodes in the same order, the same `.adw-tab-*` classes, the
// same derivations from `@gjsify/adwaita-core` — so the markup lives here once and each
// widget owns the parts that are genuinely its own: the bar the page list scrolls in, the
// selection, and whether the strip is revealed at all.
//
// The two measurements are here for the reason `adw-tab-view.ts` used `offsetLeft` and
// got it wrong: both are read in the BAR's scroll space, so both take the bar as an
// argument instead of finding an offsetParent, and neither can be reused by a caller that
// has a different strip.
//
// Reference: refs/libadwaita/src/adw-tab.c (the chip: title, icons, close button, pinned)
// Reference: refs/libadwaita/src/adw-tab-box.c (SPACING, update_visible, scroll_to_tab_full)
// Copyright (c) 2020-2022 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented for @gjsify/adwaita-web; the chip is a `<button>` and the
// indicator nodes are `<gtk-image>`.

import { tabCloseVisible, tabIconState, tabTooltip } from '@gjsify/adwaita-core';
import type { AdwTabPageState } from '@gjsify/adwaita-core';

import { type GtkImage, createGtkImage } from './elements/gtk-image.js';

export type AdwTabBarPage = AdwTabPageState<HTMLElement>;

/** `SPACING`: the slack `scroll_to_tab_full` allows before it scrolls (adw-tab-box.c:24). */
export const TAB_SPACING = 5;

/** The five nodes of one chip, held so a caller can refresh one without re-querying it. */
export interface TabChip {
    /** The button itself: `role="tab"`, carrying `data-page-id`. */
    el: HTMLButtonElement;
    icon: GtkImage;
    spinner: HTMLElement;
    label: HTMLElement;
    indicator: GtkImage;
    close: HTMLButtonElement;
}

/** What the chip asks its bar for; the bar owns the model and the page list. */
export interface TabChipHooks {
    /** The chip was pressed — libadwaita's `select_page`. */
    onSelect: () => void;
    /** The close affordance was pressed; `AdwTab`'s own button, which stops propagation. */
    onClose: () => void;
    /** Pointer in or out of the chip, for `update_visible`'s `hovering` term. */
    onHover: (hovering: boolean) => void;
}

/**
 * One chip, node for node: the icon, the spinner that replaces it while the page is
 * loading, the title, the attention indicator and the close affordance — in that order,
 * because `AdwTab`'s template puts the close button LAST and the indicator before it.
 */
export const createTabChip = (hooks: TabChipHooks): TabChip => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'adw-tab';
    el.setAttribute('role', 'tab');

    // Decorative mask-image nodes — <gtk-image> carries the convention, including the
    // `-symbolic` strip, which is ours and not C's: there the name reaches `GtkImage`
    // untouched.
    const icon = createGtkImage(null, 'adw-tab-icon');

    // `AdwTabPage:loading` swaps the icon image for an `AdwSpinnerPaintable` — the SAME
    // paintable `Adw.Spinner` uses (`update_icons`). So this is a real `<adw-spinner>` in
    // the icon's slot, not a ring drawn again in CSS: a CSS copy inherits every spinner
    // defect independently.
    const spinner = document.createElement('adw-spinner');
    spinner.className = 'adw-tab-spinner';
    spinner.setAttribute('size', '16');
    spinner.hidden = true;

    const label = document.createElement('span');
    label.className = 'adw-tab-title';

    const indicator = createGtkImage(null, 'adw-tab-indicator');

    // Close affordance — a small flat button drawn with a CSS "×" glyph. NOT because the
    // glyph is unavailable: `window-close` is in the ICONS map and has a mask class. It is a
    // SIZING difference — upstream's close button is 24px around a 16px symbolic
    // (adw-tab.ui:77) and a 16px-grid symbolic scaled into a narrower chip is a design
    // change, not a rename.
    //
    // C's `can-focus=False` is NOT set here, and that is where the roving obligation
    // decides it: `scripts/check-adwaita-keyboard-contract.mjs` holds a negative tabindex
    // against the file that registers the arrow keys behind it, and a builder shared by two
    // bars registers none. Each widget sets `close.tabIndex` beside its own key handling.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'adw-tab-close';
    close.setAttribute('aria-label', 'Close tab');
    close.addEventListener('click', (event) => {
        event.stopPropagation();
        hooks.onClose();
    });

    el.append(icon, spinner, label, indicator, close);
    el.addEventListener('click', () => hooks.onSelect());
    el.addEventListener('pointerenter', () => hooks.onHover(true));
    el.addEventListener('pointerleave', () => hooks.onHover(false));

    return { el, icon, spinner, label, indicator, close };
};

/**
 * `update_icons`, `update_title` and `update_needs_attention` — everything about a chip
 * that reads off its PAGE rather than off the bar. The bar keeps the geometry half
 * ({@link refreshTabChipClose}) to itself, because that is measured against ITS scroll
 * window and only it knows where the chip sits in it.
 */
export const refreshTabChip = (chip: TabChip, page: AdwTabBarPage, defaultIcon: string | null): void => {
    chip.label.textContent = page.title;
    // The tooltip is Pango MARKUP when the page sets one of its own. The DOM `title`
    // attribute is a TEXT sink, so the markup is shown verbatim rather than pushed
    // through an HTML sink — interpreting it would execute page-supplied markup.
    chip.el.title = tabTooltip(page);
    chip.el.classList.toggle('pinned', page.pinned);
    chip.el.classList.toggle('needs-attention', page.needsAttention);
    chip.el.classList.toggle('closing', page.closing);

    const icons = tabIconState(page, defaultIcon);
    chip.icon.iconName = icons.icon;
    // The two occupy the same slot and are never both visible: C REPLACES the image's
    // contents rather than stacking a second node.
    chip.icon.hidden = !icons.iconVisible || icons.spinner;
    // The spinner is mounted only while it spins, so an idle tab holds no element in the
    // shared rAF ticker.
    chip.spinner.hidden = !(icons.spinner && icons.iconVisible);
    chip.indicator.iconName = page.indicatorIcon;
    chip.indicator.hidden = !icons.indicatorVisible;
};

/**
 * `get_tab_position` in the BAR's scroll space: how far the chip sits from the strip's
 * scroll origin, the one coordinate both `scroll_to_tab_full` and `update_visible` compare
 * against the adjustment.
 *
 * Never `offsetLeft`. Nothing in a tab bar is positioned, so a chip's offsetParent is
 * whichever positioned ancestor the HOST page happens to have; a bar that merely sits
 * indented then measured every chip against the wrong origin and reported all of them
 * clipped.
 */
export const chipPosition = (bar: HTMLElement, chip: HTMLElement): number =>
    chip.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;

/**
 * `update_visible` (adw-tab-box.c:769-797) as libadwaita applies it, with the pinned gate
 * from `AdwTab` folded in: `(hovering && fullyVisible) || selected`, never on a pinned tab.
 *
 * `dragging` is constantly false — tab drag-and-drop is compositor work and is not modelled
 * — and the SPACING slack C also demands is deliberately NOT transplanted, because it is not
 * slack there either: the allocation loop starts the first tab at `pos = SPACING` and puts
 * SPACING between tabs (:3270-3286), so `pos - SPACING >= value` is exactly "flush against
 * the leading edge". A strip without those gaps would report the first chip clipped.
 */
export const refreshTabChipClose = (
    bar: HTMLElement,
    chip: TabChip,
    page: AdwTabBarPage,
    state: { hovering: boolean; selected: boolean },
): void => {
    const value = bar.scrollLeft;
    const pos = chipPosition(bar, chip.el);
    const fullyVisible = pos >= value && pos + chip.el.offsetWidth <= value + bar.clientWidth;
    chip.close.hidden = !tabCloseVisible({
        hovering: state.hovering,
        fullyVisible,
        selected: state.selected,
        dragging: false,
        pinned: page.pinned,
    });
};

/**
 * `scroll_to_tab_full` (adw-tab-box.c:928-961): bring the chip inside the BAR's own scroll
 * window, padded by half of whichever is smaller, the chip or the leftover.
 *
 * The bar is the only thing C ever scrolls for a tab — `scroll_to_tab_full` writes
 * `self->adjustment`, the strip's own adjustment, and nothing else. The DOM has no such
 * narrow API: `focus()` and `scrollIntoView()` both walk EVERY scrollable ancestor up to
 * the window. So this moves `scrollLeft` by hand, and the caller passes `preventScroll` to
 * `focus()`.
 */
export const scrollChipIntoBar = (bar: HTMLElement, chip: HTMLElement): void => {
    const pageSize = bar.clientWidth;
    const width = chip.offsetWidth;
    // Unmeasured (detached, or still inside connectedCallback): nothing to scroll to.
    if (pageSize <= 0 || width <= 0) return;

    const value = bar.scrollLeft;
    const pos = chipPosition(bar, chip);
    const padding = Math.min(width, pageSize - width) / 2;
    if (pos - TAB_SPACING < value) bar.scrollLeft = pos - padding;
    else if (pos + width + TAB_SPACING > value + pageSize) bar.scrollLeft = pos + width + padding - pageSize;
};
