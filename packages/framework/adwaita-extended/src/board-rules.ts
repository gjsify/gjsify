import type { SizeClass } from './size-class.js';

/** How a kanban board lays its columns out: one at a time, a scrolling strip, or all side by side. */
export type BoardPresentation = 'single' | 'scroll' | 'all';

/** Medium shows this many columns at once; the strip scrolls for the rest. */
export const MEDIUM_VISIBLE_COLUMNS = 2;
/** Space between columns and at the strip's edges, px. */
export const COLUMN_GAP = 12;
/** A sliver of the next column stays visible in the strip, so it reads as scrollable. */
export const COLUMN_PEEK = 24;
/** Narrowest a column may get before its cards stop being legible. */
export const MIN_COLUMN_WIDTH = 220;
/** Space between two cards in a column, px. */
export const CARD_SPACING = 8;

/** Pure: compact pages one column, medium scrolls a strip, wide shows every column. */
export function boardPresentation(sizeClass: SizeClass): BoardPresentation {
    switch (sizeClass) {
        case 'compact':
            return 'single';
        case 'medium':
            return 'scroll';
        case 'wide':
            return 'all';
    }
}

/** Pure: how many of `count` columns are on screen at once. */
export function visibleColumns(sizeClass: SizeClass, count: number): number {
    if (!Number.isFinite(count) || count <= 0) return 0;
    switch (boardPresentation(sizeClass)) {
        case 'single':
            return 1;
        case 'scroll':
            return Math.min(MEDIUM_VISIBLE_COLUMNS, count);
        case 'all':
            return count;
    }
}

/**
 * Pure: the width of one column where columns stand side by side, or `null` in `single`, where
 * the one column on screen simply fills the page. The `visible` columns share `available`; in the
 * strip a peek of the next one is kept back, unless every column already fits.
 *
 * `all` gets a width too, rather than letting the columns ask for theirs: the board is as wide as
 * the room it is given, which is not the whole window — an open inspector takes its share — and a
 * column that cannot shrink would be cut off at the edge instead. Below `MIN_COLUMN_WIDTH` the
 * columns stop shrinking and the strip scrolls.
 */
export function columnWidth(sizeClass: SizeClass, available: number, count: number): number | null {
    const presentation = boardPresentation(sizeClass);
    if (presentation === 'single') return null;
    const visible = visibleColumns(sizeClass, count);
    if (visible === 0 || !Number.isFinite(available)) return null;
    const peek = presentation === 'scroll' && count > visible ? COLUMN_PEEK : 0;
    const room = available - COLUMN_GAP * (visible + 1) - peek;
    return Math.max(MIN_COLUMN_WIDTH, Math.floor(room / visible));
}

/** Pure: keeps a column index inside `0 … count-1`; `-1` when there is no column. */
export function clampColumn(index: number, count: number): number {
    if (!Number.isFinite(index) || count <= 0) return -1;
    return Math.min(Math.max(Math.round(index), 0), count - 1);
}

/**
 * Pure: the card to focus when the arrow keys move `dx` columns sideways from card `index`.
 * Skips empty columns; `null` when no column in that direction has a card.
 */
export function neighbourFocus(
    column: number,
    index: number,
    dx: number,
    sizes: readonly number[],
): { column: number; index: number } | null {
    const step = Math.sign(dx);
    if (step === 0) return null;
    for (let c = column + step; c >= 0 && c < sizes.length; c += step) {
        const size = sizes[c] ?? 0;
        if (size > 0) return { column: c, index: Math.min(Math.max(index, 0), size - 1) };
    }
    return null;
}

/** Pure: the scroll offset that puts column `index` at the strip's start edge. */
export function columnOffset(index: number, width: number, count: number): number {
    const column = clampColumn(index, count);
    if (column < 0 || !Number.isFinite(width) || width <= 0) return 0;
    return column * (width + COLUMN_GAP);
}

/** Pure: the column a strip scrolled to `offset` should settle on (nearest column start). */
export function snapColumn(offset: number, width: number, count: number): number {
    if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return clampColumn(0, count);
    return clampColumn(offset / (width + COLUMN_GAP), count);
}

/**
 * Pure: whether a card may be dragged. A `Gtk.DragSource` is attached to every card and asks this
 * when the drag starts, so a board that becomes writable needs no rebuild; a read-only card (a
 * source that cannot be written) never gets a grip, whatever the board.
 */
export function canDrag(cardReadOnly: boolean, boardWritable: boolean): boolean {
    return boardWritable && !cardReadOnly;
}

/** One card's vertical extent inside a column's card box, as its allocation reports it. */
export interface CardExtent {
    /** Top edge, px, relative to the box the cards sit in — the drop target's own coordinates. */
    top: number;
    height: number;
}

/**
 * Pure: the index a card dropped at `y` is inserted BEFORE; `extents.length` means after the last
 * one. A card is split at its middle, so the half a pointer is over decides, and a drop below
 * every card lands at the end — an empty column therefore answers 0.
 */
export function dropIndex(y: number, extents: readonly CardExtent[]): number {
    if (!Number.isFinite(y)) return extents.length;
    for (let i = 0; i < extents.length; i++) {
        const extent = extents[i];
        if (y < extent.top + extent.height / 2) return i;
    }
    return extents.length;
}

/**
 * Pure: the position a drop asks the host to write, or `null` when the card would land exactly
 * where it already is and there is nothing to ask for.
 *
 * Within one column the dragged card is still in the list while it is dragged, so `dropIndex`
 * counts it: taking it out first shifts everything below up by one, which is why a drop just under
 * its own place is the place it already has.
 */
export function dropPlacement(sameColumn: boolean, fromIndex: number, rawIndex: number): number | null {
    if (!sameColumn) return Math.max(0, rawIndex);
    const index = rawIndex > fromIndex ? rawIndex - 1 : rawIndex;
    return index === fromIndex ? null : Math.max(0, index);
}

/**
 * Pure: the column a card moves to when the keyboard moves it `dx` columns sideways from `column`,
 * or `null` at either end. Dragging needs a pointer; this is the same move without one.
 */
export function moveColumn(column: number, dx: number, count: number): number | null {
    const step = Math.sign(dx);
    if (step === 0 || count <= 0) return null;
    const next = column + step;
    return next >= 0 && next < count ? next : null;
}
