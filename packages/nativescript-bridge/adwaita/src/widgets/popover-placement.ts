// Where a popover's card goes — the pure half of `GtkPopover` for NativeScript.
//
// GTK positions a popover with `gtk_popover_present`'s positioner: centred on the anchor along
// the cross axis, on the preferred side along the main one, FLIPPED to the other side when the
// preferred one has no room, and finally SLID back onto the screen. The browser leaves all of
// that to CSS (`popover-core.ts` says why); this surface has no CSS positioner, so the decision
// is a function of three rectangles and lives here, free of `@nativescript/core`, where a spec
// can drive it without a view.
//
// Reference: refs/gtk gtk/gtkpopover.c (gtk_popover_present, the surface layout)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** A rectangle in DIPs, origin top-left. */
export interface PlacementRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** A size in DIPs. */
export interface PlacementSize {
    readonly width: number;
    readonly height: number;
}

/** The sides this surface places a popover on. `left` and `right` are not built (see `gtk-popover.ts`). */
export type PopoverSide = 'top' | 'bottom';

/** Room kept between the card and the window edge, in DIPs. */
export const POPOVER_WINDOW_MARGIN = 8;

/** Room between the anchor and the card, in DIPs — where GTK draws its arrow. */
export const POPOVER_ANCHOR_GAP = 6;

/** Where the card's top-left corner goes (relative to the window) and which side it ended up on. */
export interface PopoverPlacement {
    readonly left: number;
    readonly top: number;
    readonly side: PopoverSide;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

/**
 * The card's place for an `anchor` inside a `window`, preferring `side`.
 *
 * The preferred side wins whenever the card fits there. When it does not and the other side
 * does, the card flips. When neither fits it takes the side with more room and is slid back
 * onto the window — the same last resort GTK's positioner has, and the reason the answer is
 * always inside `[margin, window − card − margin]` (or pinned at `margin` for a card larger
 * than the window, which is the only place it can still be reached from).
 */
export function popoverPlacement(
    anchor: PlacementRect,
    card: PlacementSize,
    window: PlacementSize,
    side: PopoverSide,
    margin: number = POPOVER_WINDOW_MARGIN,
    gap: number = POPOVER_ANCHOR_GAP,
): PopoverPlacement {
    const below = anchor.y + anchor.height + gap;
    const above = anchor.y - gap - card.height;
    const fitsBelow = below + card.height <= window.height - margin;
    const fitsAbove = above >= margin;

    let chosen: PopoverSide = side;
    if (side === 'bottom' && !fitsBelow && fitsAbove) chosen = 'top';
    else if (side === 'top' && !fitsAbove && fitsBelow) chosen = 'bottom';
    else if (!fitsBelow && !fitsAbove) {
        const roomBelow = window.height - (anchor.y + anchor.height);
        const roomAbove = anchor.y;
        chosen = roomBelow >= roomAbove ? 'bottom' : 'top';
    }

    const wanted = chosen === 'bottom' ? below : above;
    const top = clamp(wanted, margin, Math.max(margin, window.height - margin - card.height));
    const centred = anchor.x + anchor.width / 2 - card.width / 2;
    const left = clamp(centred, margin, Math.max(margin, window.width - margin - card.width));
    return { left, top, side: chosen };
}
