// Popover conformance vectors — the surface metrics and the keyboard moves both
// renderers are held to.
//
// These exist because three web elements hand-rolled a popover and NO TWO AGREED: the menu
// button and drop-down drew a 12px (`--card-radius`) surface, the split button a 9px
// (`--button-radius`) one with a 2-layer shadow of its own invention, and libadwaita draws
// 15px with three layers. All three padded with 6px, and all three shipped.
//
// WHICH SELECTOR WINS THE CASCADE (the rule lives in ./index.ts): `popover > contents` says
// `padding: 8px`, but further into `_menus.scss` `popover.menu > contents` re-declares
// `padding: 0` and moves the inset onto the item box as `$menu_margin`. Two element
// selectors plus a class beats one element selector plus a child, so a MENU popover is
// 0 + 6px and a plain one is 8px — both numbers are correct and the class decides which.
// Grep the whole stylesheet for `contents`, not just the first block that mentions it.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_popovers.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss
// Reference: refs/libadwaita/src/stylesheet/_common.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { PopoverKeyContext, PopoverKeyResolution } from '../popover.js';

/** Which popover surface a {@link PopoverSurfaceVector} describes. */
export type PopoverSurfaceVariant =
    /** A bare popover — `popover > contents`. */
    | 'plain'
    /** A menu popover — `popover.menu > contents` + its item box. */
    | 'menu'
    /** One menu row — `modelbutton`. */
    | 'menu-item';

/** One popover surface expectation, derived from the vendored stylesheet. */
export interface PopoverSurfaceVector {
    variant: PopoverSurfaceVariant;
    /** Inner inset in px — where the whitespace around the content actually comes from. */
    padding: number;
    /** Corner radius in px. */
    borderRadius: number;
    /**
     * The `box-shadow` layers' GEOMETRY, in the spelling `getComputedStyle`
     * returns (`0px`, not `0`) so a renderer can substring-match the computed
     * value without re-implementing colour serialisation. Empty when the node
     * casts no shadow.
     *
     * The COUNT is the load-bearing part: the split button shipped two layers
     * where libadwaita has three.
     */
    shadow: readonly string[];
    /** The libadwaita selector that WINS the cascade for these values. */
    selector: string;
    /** Where it is vendored, with lines. */
    source: string;
    rule: string;
}

/** The exact three-layer elevation of `popover > contents` (_popovers.scss:18-20). */
const POPOVER_SHADOW = ['0px 0px 0px 1px', '0px 1px 5px 1px', '0px 2px 14px 3px'] as const;

/** Popover surface metrics (_popovers.scss:13-21, _menus.scss:58-66). */
export const POPOVER_SURFACE_VECTORS: ReadonlyArray<PopoverSurfaceVector> = [
    {
        variant: 'plain',
        padding: 8,
        borderRadius: 15,
        shadow: POPOVER_SHADOW,
        selector: 'popover > contents',
        source: 'refs/libadwaita/src/stylesheet/widgets/_popovers.scss:13-21',
        rule: '$popover_radius = $menu_radius + 6 = 15px (_common.scss:10,13) — NOT $card_radius (12px, what the menu button and drop-down used) and NOT $button_radius (9px, what the split button used)',
    },
    {
        variant: 'menu',
        padding: 6,
        borderRadius: 15,
        shadow: POPOVER_SHADOW,
        selector: 'popover.menu > contents (padding) — beats `popover > contents`',
        source: 'refs/libadwaita/src/stylesheet/widgets/_menus.scss:58-66',
        rule: 'a MENU popover zeroes the contents padding and puts $menu_margin (6px, _common.scss:11) on the item box — the same 6px inset all three copies already had. Only the radius and the shadow were ever wrong. NB `.menu` is a STYLE CLASS, not an a11y role: a GtkDropDown popover carries it (`dropdown { popover.menu { … } }`, _dropdowns.scss:22) while its rows are ARIA options, so a renderer that keys the surface off `role` pads the drop-down like a bare content popover.',
    },
    {
        variant: 'menu-item',
        // `padding: 0 $menu_padding` — the vertical inset comes from min-height: 32px.
        padding: 12,
        borderRadius: 9,
        shadow: [],
        selector: 'popover.menu modelbutton',
        source: 'refs/libadwaita/src/stylesheet/widgets/_menus.scss:134-138',
        rule: 'a menu row is $menu_radius (9px), NOT `calc(var(--button-radius) - 2px)` (7px) as the menu button and split button each independently invented',
    },
];

/** One `resolvePopoverKey` expectation. */
export interface PopoverKeyVector {
    /** `KeyboardEvent.key`. */
    key: string;
    context: PopoverKeyContext;
    expected: PopoverKeyResolution;
    rule: string;
}

/**
 * `resolvePopoverKey` — the wrap arithmetic `gtk-menu-button.ts` and
 * `gtk-drop-down.ts` each carried a copy of, reconciled.
 *
 * The rows that matter are the ones the two copies got WRONG rather than merely
 * duplicated: ArrowUp from an unfocused list (both computed `n - 2`), and Home/End while a
 * search entry owns the caret (the drop-down stole both).
 *
 * CORE-ONLY: GAP — `gtk-popover` calls `resolvePopoverKey` on keydown but publishes no readable outcome for a spec to compare. Tracked in #1072
 */
export const POPOVER_KEY_VECTORS: ReadonlyArray<PopoverKeyVector> = [
    {
        key: 'ArrowDown',
        context: { itemCount: 3, currentIndex: -1 },
        expected: { action: 'focus', index: 0 },
        rule: 'entering an unfocused list from the top',
    },
    {
        key: 'ArrowDown',
        context: { itemCount: 3, currentIndex: 0 },
        expected: { action: 'focus', index: 1 },
        rule: 'the plain step',
    },
    {
        key: 'ArrowDown',
        context: { itemCount: 3, currentIndex: 2 },
        expected: { action: 'focus', index: 0 },
        rule: 'wraps past the end',
    },
    {
        key: 'ArrowDown',
        context: { itemCount: 1, currentIndex: 0 },
        expected: { action: 'focus', index: 0 },
        rule: 'a one-item list wraps onto itself — `% 1` must not divide by zero or land on -1',
    },
    {
        key: 'ArrowUp',
        context: { itemCount: 3, currentIndex: -1 },
        expected: { action: 'focus', index: 2 },
        rule: 'THE FIX: both copies computed (-1 - 1 + n) % n = n - 2, landing on the SECOND-TO-LAST item. Reachable on every `enable-search` open, which focuses the entry (currentIndex -1). ArrowUp from nothing enters at the END.',
    },
    {
        key: 'ArrowUp',
        context: { itemCount: 3, currentIndex: 0 },
        expected: { action: 'focus', index: 2 },
        rule: 'wraps past the start',
    },
    {
        key: 'ArrowUp',
        context: { itemCount: 3, currentIndex: 2 },
        expected: { action: 'focus', index: 1 },
        rule: 'the plain step',
    },
    {
        key: 'ArrowUp',
        context: { itemCount: 1, currentIndex: 0 },
        expected: { action: 'focus', index: 0 },
        rule: 'a one-item list wraps onto itself',
    },
    {
        key: 'Home',
        context: { itemCount: 4, currentIndex: 2 },
        expected: { action: 'focus', index: 0 },
        rule: 'jumps to the first item',
    },
    {
        key: 'End',
        context: { itemCount: 4, currentIndex: 1 },
        expected: { action: 'focus', index: 3 },
        rule: 'jumps to the last item',
    },
    {
        key: 'Home',
        context: { itemCount: 4, currentIndex: -1, hasSearch: true },
        expected: { action: 'none', index: -1 },
        rule: 'the search entry owns the caret — the drop-down stole Home unconditionally, so you could not jump to the start of the query you were typing',
    },
    {
        key: 'End',
        context: { itemCount: 4, currentIndex: -1, hasSearch: true },
        expected: { action: 'none', index: -1 },
        rule: 'same for End — caret to end of query, not focus to last option',
    },
    {
        key: 'Home',
        context: { itemCount: 4, currentIndex: 2, hasSearch: true },
        expected: { action: 'focus', index: 0 },
        rule: 'once focus has LEFT the entry, a searchable popover navigates like any other',
    },
    {
        key: 'Enter',
        context: { itemCount: 3, currentIndex: 1 },
        expected: { action: 'activate', index: 1 },
        rule: 'Enter picks the focused item — the menu button had no case for it and leaned on the browser activating a focused <button>',
    },
    {
        key: ' ',
        context: { itemCount: 3, currentIndex: 1 },
        expected: { action: 'activate', index: 1 },
        rule: 'Space picks the focused item',
    },
    {
        key: 'Enter',
        context: { itemCount: 3, currentIndex: -1 },
        expected: { action: 'none', index: -1 },
        rule: 'nothing focused, nothing to activate',
    },
    {
        key: ' ',
        context: { itemCount: 3, currentIndex: -1, hasSearch: true },
        expected: { action: 'none', index: -1 },
        rule: 'Space in the search entry types a space; it must never activate an option',
    },
    {
        key: 'Escape',
        context: { itemCount: 3, currentIndex: 1 },
        expected: { action: 'close', index: -1 },
        rule: 'Escape dismisses — `adw-split-button` had no Escape handling at all',
    },
    {
        key: 'Escape',
        context: { itemCount: 0, currentIndex: -1 },
        expected: { action: 'close', index: -1 },
        rule: 'Escape closes even an empty popover: it is the escape hatch, not a move, so it is resolved BEFORE the empty-list guard',
    },
    {
        key: 'ArrowDown',
        context: { itemCount: 0, currentIndex: -1 },
        expected: { action: 'none', index: -1 },
        rule: 'an empty list has nothing to move to — never returns index 0 for a list with no item 0',
    },
    {
        key: 'ArrowDown',
        context: { itemCount: 3, currentIndex: 7 },
        expected: { action: 'focus', index: 0 },
        rule: 'an out-of-range currentIndex (a stale index after a filter shrank the list) is treated as "nothing focused"',
    },
    {
        key: 'Tab',
        context: { itemCount: 3, currentIndex: 0 },
        expected: { action: 'none', index: -1 },
        rule: 'Tab is deliberately unhandled — GTK traps focus in a popover, but doing that in the DOM is a renderer concern with no portable arithmetic',
    },
    {
        key: 'a',
        context: { itemCount: 3, currentIndex: 0 },
        expected: { action: 'none', index: -1 },
        rule: 'a printable key belongs to the renderer (the drop-down type-ahead), not to this table',
    },
];
