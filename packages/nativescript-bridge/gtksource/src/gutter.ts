// Arithmetic for the line-number gutter, kept out of the Canvas code so it can be tested.

/** Digits needed to write `lineCount`; never fewer than `minDigits`, so a 9-line file does not jitter at line 10. */
export function digitCount(lineCount: number, minDigits = 2): number {
    return Math.max(minDigits, String(Math.max(1, lineCount)).length);
}

/** Total gutter width in pixels: the widest label plus padding on both sides. */
export function gutterWidth(lineCount: number, digitWidth: number, padding: number, minDigits = 2): number {
    return Math.ceil(digitCount(lineCount, minDigits) * digitWidth + 2 * padding);
}

/**
 * The lines whose vertical extent meets `[viewTop, viewBottom)`, found by binary search over
 * the layout's line tops so a 10 000-line file draws the ~40 labels it shows, not 10 000.
 * `lineBottom(i)` is the bottom edge of line `i`; both edges are in the same pixel space as
 * the view range. `null` when nothing is visible.
 */
export function visibleLines(
    lineCount: number,
    lineTop: (line: number) => number,
    lineBottom: (line: number) => number,
    viewTop: number,
    viewBottom: number,
): { first: number; last: number } | null {
    if (lineCount <= 0) return null;
    let low = 0;
    let high = lineCount - 1;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (lineBottom(mid) <= viewTop) low = mid + 1;
        else high = mid;
    }
    const first = low;
    if (lineTop(first) >= viewBottom || lineBottom(first) <= viewTop) return null;
    low = first;
    high = lineCount - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineTop(mid) < viewBottom) low = mid;
        else high = mid - 1;
    }
    return { first, last: low };
}
