// Where an `AdwBottomSheet`'s bottom window inset goes — pure, so a Linux runner can pin it.
//
// A sheet is the one widget that is ALWAYS on the screen's bottom edge, in two different shapes,
// and the inset it owes has a different form in each:
//
//   - CLOSED, the thing at the edge is the bottom bar. It takes the inset as ORDINARY padding, so
//     its label sits above the gesture pill while the panel's background runs on under it.
//   - OPEN, the thing at the edge is a scrolling surface. The inset then belongs at the END OF THE
//     SCROLL CONTENT, not around the viewport — Android's `clipToPadding = false`, and the same
//     thing a `contentInset` buys on iOS.
//
// WHY THE DIFFERENCE IS NOT COSMETIC. Padding the panel (or the page inside it) shortens the
// viewport: the text is then hard-clipped a gesture area above the screen edge, with a blank band
// of panel colour under it — MEASURED on a 2560x1600 tablet, the last line of the quick help was
// cut through the middle and 48 dip of white sat below it. Inside the content the same number
// scrolls: the text runs under the pill as the finger moves it, and only the LAST line comes to
// rest clear of it. That is what the GNOME original does with no inset at all, because a
// `GtkScrolledWindow` there reaches the window edge.
//
// The gap a sheet keeps under its content is the SAME number whether or not a platform charges an
// inset, so it is added here rather than left to the stylesheet: off Android the reading is zero
// and `scrollEnd` is the bare gap.
//
// Reference: refs/libadwaita/src/adw-bottom-sheet.c (the sheet owns the bottom edge)

/**
 * What an open sheet keeps clear under its content, in dip — libadwaita's own bottom padding on
 * `> sheet` (`_bottom-sheet.scss`). The stylesheet states the other three edges; this one is in
 * code because it has to land INSIDE the scrolling content, where no selector reaches.
 */
export const SHEET_CONTENT_BOTTOM_GAP = 16;

/** What the sheet looks like, as far as paying the bottom inset cares. */
export interface BottomSheetInsetShape {
    /** Whether the sheet's child scrolls — which is what decides the form of the payment. */
    readonly sheetScrolls: boolean;
}

/** The bottom padding each part of a sheet takes, in dip. */
export interface BottomSheetInsetPadding {
    /** The bottom bar's bin: the closed sheet's form, which clears the gesture area outright. */
    readonly bar: number;
    /** Added after the scrolling content, so the text scrolls under the gesture area. */
    readonly scrollEnd: number;
    /** The sheet page's own padding — the fallback for a sheet child that does not scroll. */
    readonly page: number;
}

/**
 * Split a sheet's bottom window inset between its bar, its scrolling content and its page.
 *
 * The inset is paid EXACTLY ONCE per shape: the bar pays it for the closed sheet, and the open
 * sheet pays it either in its scroll content or — with nothing to scroll — in the page, never in
 * both. Paying it in both is the doubled band the toolbar view's arithmetic also guards against
 * (`toolbarViewInsetPadding`, `window-insets.ts`).
 *
 * A reading that is not a positive number is nothing: this value crosses the NativeScript bridge
 * from a native object, and a `NaN` padding renders as zero padding and no error.
 */
export function bottomSheetInsetPadding(inset: number, shape: BottomSheetInsetShape): BottomSheetInsetPadding {
    const owed = Number.isFinite(inset) && inset > 0 ? inset : 0;
    return {
        bar: owed,
        scrollEnd: shape.sheetScrolls ? owed + SHEET_CONTENT_BOTTOM_GAP : 0,
        page: shape.sheetScrolls ? 0 : owed + SHEET_CONTENT_BOTTOM_GAP,
    };
}
