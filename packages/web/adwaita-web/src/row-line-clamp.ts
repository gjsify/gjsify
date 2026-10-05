// Row line-clamping utilities — shared by adw-action-row, adw-switch-row,
// adw-combo-row, adw-spin-row, adw-expander-row.
//
// The clamping uses the package's established pattern: CSS custom properties
// (--adw-row-title-lines, --adw-row-subtitle-lines) + a class toggle
// (.adw-row-clamp on the text container). See gtk-label.ts for the same
// pattern with --gtk-label-lines and .adw-label-clamp.
//
// Upstream semantics (AdwActionRow, AdwExpanderRow):
//   - title-lines / subtitle-lines default to 0
//   - 0 = unlimited lines (wrap freely, no ellipsis)
//   - n > 0 = clamp to n lines with ellipsis
//   - Negative values are invalid per the pspec (range 0..G_MAXINT) and
//     treated as 0 (unlimited) — the property system clamps them.

export interface RowLineClampConfig {
    titleEl: HTMLElement;
    subtitleEl: HTMLElement;
    textContainerEl: HTMLElement; // The element that gets .adw-row-clamp
    getTitleLines: () => number;
    getSubtitleLines: () => number;
}

/**
 * Apply or remove line clamping based on title-lines/subtitle-lines values.
 * Uses CSS custom properties and class toggle (not inline styles).
 */
export function applyRowLineClamp(config: RowLineClampConfig): void {
    const { titleEl, subtitleEl, textContainerEl, getTitleLines, getSubtitleLines } = config;

    const titleLines = getTitleLines();
    const subtitleLines = getSubtitleLines();

    const titleClamped = titleLines > 0;
    const subtitleClamped = subtitleLines > 0;
    const anyClamped = titleClamped || subtitleClamped;

    // Toggle the clamping class on the text container
    textContainerEl.classList.toggle('adw-row-clamp', anyClamped);

    // Set custom properties for the clamp line counts
    if (titleClamped) {
        titleEl.style.setProperty('--adw-row-title-lines', String(titleLines));
    } else {
        titleEl.style.removeProperty('--adw-row-title-lines');
    }

    if (subtitleClamped) {
        subtitleEl.style.setProperty('--adw-row-subtitle-lines', String(subtitleLines));
    } else {
        subtitleEl.style.removeProperty('--adw-row-subtitle-lines');
    }

    // The ellipsize overflow is shared (end ellipsis for all non-none modes)
    // Set it on the text container so the clamp rule can read it
    if (anyClamped) {
        textContainerEl.style.setProperty('--adw-row-ellipsize-overflow', 'ellipsis');
    } else {
        textContainerEl.style.removeProperty('--adw-row-ellipsize-overflow');
    }
}

/**
 * Parse a lines attribute value following AdwActionRow semantics:
 * - Missing/null/empty → 0 (unlimited)
 * - Invalid/non-numeric → 0 (unlimited)
 * - n > 0 → n (clamp to n lines)
 * - n <= 0 → 0 (unlimited; pspec range is 0..G_MAXINT)
 */
export function parseRowLinesAttribute(value: string | null): number {
    if (value === null || value === '') return 0;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}