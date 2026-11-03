// A `GridLayout` with one `star` cell is this port's shape for every button-like widget
// (`GtkButton`, `AdwImageButton`, `AdwAvatar`, `AdwSplitButton`'s halves): the cell FILLS the
// widget, so the child's `horizontalAlignment: 'center'` centres it. That holds only while the
// cell is as big as the widget, and on iOS it is not.
//
// MEASURED on an iPhone 17 simulator (2026-11-03), Learn6502's gamepad A/B buttons: the letter
// sat in the top-left CORNER of a 55×55 circle, clipped by the border radius. `GridLayout`'s
// iOS measure pass sizes a star cell from its CONTENT whenever the grid is not stretched —
// `MeasureHelper.measure()` ends with "if we are not stretched and minColumnStarValue is less
// than maxColumnStarValue we need to reduce the width of star columns" — and the grid is not
// stretched here because its parent (a horizontal box) measures it with UNSPECIFIED width,
// which `stretchedHorizontally = widthMode === EXACTLY || (horizontalAlignment === 'stretch' &&
// !infinityWidth)` answers `false` for. The widget's OWN floor is applied one step later, to the
// grid's measurement only (`measureWidth = Math.max(measureWidth, this.effectiveMinWidth)`), and
// never flows back into the cell. So the view came out 55×55 and its single cell 10×18, and the
// child was centred inside the LABEL rather than inside the button. Logged at the time:
// `btn minWH=165x165 col=0 row=0 stretch=false/false childAlign=center/middle` (device pixels,
// scale 3).
//
// A CSS restatement of the same intent (`horizontal-align`/`text-align: center` on
// `.adw-button-label`) was tried first and measured to change nothing, which is what says the
// alignment was never the missing half: `View.layoutChild` reads exactly that property and had
// been reading `'center'` all along, over a cell with nothing to centre in.
//
// `width-request` STAYS a minimum (`minWidth`), as GTK means it. What this adds is the second
// half GTK has for free: a widget allocated at least its request allocates that allocation to
// its child.

import { Utils } from '@nativescript/core';

/**
 * Whether a measure pass needs a second one to tell the cells the size the first settled on.
 *
 * `false` when the parent already pinned both axes — the cells then measured against the final
 * size and nothing was floored afterwards.
 */
export function needsOwnSizePass(widthMeasureSpec: number, heightMeasureSpec: number): boolean {
    const { EXACTLY, getMeasureSpecMode } = Utils.layout;
    return getMeasureSpecMode(widthMeasureSpec) !== EXACTLY || getMeasureSpecMode(heightMeasureSpec) !== EXACTLY;
}

/** The pair of `EXACTLY` specs for a size a measure pass has already settled on. */
export function ownSizeSpecs(width: number, height: number): [number, number] {
    const { EXACTLY, makeMeasureSpec } = Utils.layout;
    return [makeMeasureSpec(width, EXACTLY), makeMeasureSpec(height, EXACTLY)];
}
