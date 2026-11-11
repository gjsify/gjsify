// How large the interface is, as ONE number — the pure half.
//
// A libadwaita stylesheet is authored in GTK logical pixels for a window around 360 of them
// wide: that is the width the adaptive layout of libadwaita's own apps is drawn for, and the
// size every padding, row height and font size in `theme/adwaita.css` is picked against. A
// phone reports more. A Galaxy S9 is 1440 physical pixels at density 3.5, so 411.4 dp, and
// NativeScript maps a GTK `px` onto exactly one dp (`css-length.ts`). The sheet therefore draws
// correctly and reads small: the same widget covers 360/411.4 = 87.5 % of the width it covers
// in the GTK app.
//
// The fix is one factor over every length (`scaleAdwaitaCss`). ONE, because a scale that only
// reached the fonts would leave the rows around them at their old height, and a scale that only
// reached the boxes would clip the text in them.
//
// It does NOT replace the system font scale. `font-size` reaches Android through `setTextSize`
// as sp, which the platform already multiplies by the user's font size setting; the app scale
// multiplies on top of it, so someone at `font_scale 1.3` gets 1.3 × the app scale and never
// 1.3 × 1.3.
//
// NEVER BELOW 1. A narrow phone (320 dp) would derive 0.89 and get an interface smaller than
// the stylesheet was written for, which is the opposite of the point: the floor is 1, the
// authored size. The ceiling is 1.5, past which a phone layout stops fitting its own
// breakpoints.
//
// TABLETS AND DESKTOPS ARE LEFT ALONE. A wide window is what the stylesheet was written for, and
// it has the room to show more at the authored size — exactly what libadwaita's breakpoints are
// for. Android's own `sw600dp` is the line.

/** What the interface scale is set to: a factor, or `'auto'` for the one derived from the screen. */
export type AppScaleSetting = 'auto' | number;

/** The logical width a libadwaita stylesheet is authored for. */
export const APP_SCALE_REFERENCE_WIDTH = 360;

/** The authored size. Below it the app would be smaller than the stylesheet means it to be. */
export const APP_SCALE_MIN = 1;

/** Past this a phone layout no longer fits the breakpoints it declares. */
export const APP_SCALE_MAX = 1.5;

/** Android's `sw600dp`: at or above this shortest edge the window is wide enough as authored. */
export const APP_SCALE_WIDE_WIDTH = 600;

/** The screen the scale is derived from, in device-independent pixels. */
export interface AppScaleScreen {
    readonly widthDips: number;
    readonly heightDips: number;
}

/** `scale` held to `[APP_SCALE_MIN, APP_SCALE_MAX]` and three decimals; a non-number becomes 1. */
export function clampAppScale(scale: number): number {
    if (!Number.isFinite(scale)) return APP_SCALE_MIN;
    const held = Math.min(APP_SCALE_MAX, Math.max(APP_SCALE_MIN, scale));
    return Math.round(held * 1000) / 1000;
}

/**
 * The scale a screen asks for: its shortest edge over the authored width, clamped.
 *
 * The SHORTEST edge, so that turning the device does not resize the interface — a phone is a
 * phone in landscape too. A screen at or past {@link APP_SCALE_WIDE_WIDTH} is left at 1.
 */
export function deriveAppScale(screen: AppScaleScreen): number {
    const shortest = Math.min(screen.widthDips, screen.heightDips);
    if (!Number.isFinite(shortest) || shortest <= 0) return APP_SCALE_MIN;
    if (shortest >= APP_SCALE_WIDE_WIDTH) return APP_SCALE_MIN;
    return clampAppScale(shortest / APP_SCALE_REFERENCE_WIDTH);
}

/** The factor to apply: the user's number when they set one, otherwise the derived default. */
export function resolveAppScale(setting: AppScaleSetting, derived: number): number {
    return setting === 'auto' ? clampAppScale(derived) : clampAppScale(setting);
}

/**
 * A length the code sets itself, scaled — the counterpart to `scaleAdwaitaCss` for the sizes no
 * stylesheet reaches: an icon's rendered square, a drag grip's height, an avatar's side.
 *
 * Rounded the way the CSS lengths are, so a constant and the rule drawn next to it agree. The
 * scale is used as given, not clamped: it comes from `resolveAppScale`, which already clamped it.
 *
 * NOT for breakpoints. A width a layout DECIDES by (`sw600dp`, a dialog's max width, a carousel's
 * fallback page) describes the screen, not the drawing on it, and scaling it would move the line
 * the layout switches at.
 */
export function scaleDip(length: number, scale: number): number {
    if (!Number.isFinite(length) || !Number.isFinite(scale)) return length;
    return Math.round(length * scale * 1000) / 1000;
}

/**
 * The factors a chooser can offer, from {@link APP_SCALE_MIN} to {@link APP_SCALE_MAX}.
 *
 * Here rather than in the app, so a setting cannot offer a factor the clamp refuses: a list that
 * went past the ceiling would show an entry that silently selects a different one.
 */
export function appScaleChoices(step = 0.1): number[] {
    const safe = Number.isFinite(step) && step > 0 ? step : 0.1;
    const steps = Math.floor((APP_SCALE_MAX - APP_SCALE_MIN) / safe + 1e-9);
    const choices: number[] = [];
    for (let i = 0; i <= steps; i++) choices.push(clampAppScale(APP_SCALE_MIN + i * safe));
    // A step that does not divide the range would otherwise leave the ceiling unreachable.
    if (choices[choices.length - 1] !== APP_SCALE_MAX) choices.push(APP_SCALE_MAX);
    return choices;
}

/** `'auto'`, or the clamped number — what a stored setting means after it is read back. */
export function parseAppScaleSetting(value: unknown): AppScaleSetting {
    if (typeof value === 'number') return clampAppScale(value);
    if (typeof value === 'string' && value.trim() !== '' && value !== 'auto') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return clampAppScale(parsed);
    }
    return 'auto';
}
