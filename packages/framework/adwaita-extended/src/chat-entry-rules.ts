/** What a key press in a chat entry means. Pure: no GTK, so Node can test it. */
export type EntryKeyAction = 'submit' | 'newline' | 'pass';

export interface EntryModifiers {
    shift: boolean;
    ctrl: boolean;
    alt?: boolean;
    meta?: boolean;
}

/** Line height (px) used to turn a line count into a height; close to the default GNOME font. */
export const LINE_HEIGHT = 22;
/** Text margins of the entry, top plus bottom. */
export const ENTRY_PADDING = 12;
export const DEFAULT_MIN_LINES = 1;
export const DEFAULT_MAX_LINES = 5;

/**
 * Enter sends; Shift+Enter and Ctrl+Enter break the line. Alt and Super with Enter belong to
 * the window or the input method, so they pass through untouched. Any other key passes.
 */
export function entryKeyAction(isEnter: boolean, modifiers: EntryModifiers): EntryKeyAction {
    if (!isEnter) return 'pass';
    if (modifiers.alt || modifiers.meta) return 'pass';
    if (modifiers.shift || modifiers.ctrl) return 'newline';
    return 'submit';
}

/** The text to submit, or `null` when there is nothing but whitespace — an empty send is a slip. */
export function submittableText(text: string): string | null {
    return text.trim().length === 0 ? null : text;
}

/** Clamp a requested line count into a sane range; non-finite input falls back to `fallback`. */
export function clampLines(lines: number, fallback: number): number {
    if (!Number.isFinite(lines)) return fallback;
    return Math.max(1, Math.floor(lines));
}

/** Content height in px for `lines` visible lines. */
export function linesToHeight(lines: number): number {
    return Math.max(1, Math.floor(lines)) * LINE_HEIGHT + ENTRY_PADDING;
}

/**
 * The min/max content height for a min/max line count. A max below the min is raised to it,
 * so the entry never ends up with a window smaller than its floor.
 */
export function entryHeightRange(minLines: number, maxLines: number): { min: number; max: number } {
    const min = clampLines(minLines, DEFAULT_MIN_LINES);
    const max = Math.max(min, clampLines(maxLines, DEFAULT_MAX_LINES));
    return { min: linesToHeight(min), max: linesToHeight(max) };
}
