// What it takes for an `AdwHeaderBar`'s title to sit in the middle of the window.
//
// `Adw.HeaderBar` centres its title on the bar, not on the room the packed buttons leave: the
// start and end boxes are allocated the same width, the wider of the two, so a bar with two
// buttons on the left and one on the right still has the title at the window's middle. A grid
// of `auto, *, auto` columns centres it between whatever the sides happen to be instead,
// which is a shift of half a button for every button of difference.
//
// Pure, so the rule is pinned off-device; the widget measures and writes the result.

/** The widths (dip) the start and end boxes are given: the wider of the two, for both. */
export function balancedSideWidth(startNatural: number, endNatural: number): number {
    return Math.ceil(Math.max(startNatural, endNatural, 0));
}

/** One packed child's footprint in a side box, as the widget reads it back after a layout. */
export interface SideChild {
    /** `View.visibility === 'visible'`: a collapsed child takes no room. */
    readonly visible: boolean;
    readonly width: number;
    readonly marginStart: number;
    readonly marginEnd: number;
}

/** The width a horizontal side box would have without any balancing: its children and padding. */
export function sideNaturalWidth(children: readonly SideChild[], padding: number): number {
    let total = padding;
    for (const child of children) if (child.visible) total += child.width + child.marginStart + child.marginEnd;
    return total;
}
