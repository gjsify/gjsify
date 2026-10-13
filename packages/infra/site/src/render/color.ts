// The app's `<branding>` colour paints the masthead, so the text on it has to be chosen for that
// colour rather than hardcoded. CSS cannot measure a colour — `color-contrast()` is not shipped
// anywhere this page targets — so the generator measures it and writes the answer into a custom
// property.

/** `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` as 0–255 channels; alpha is ignored, the band is opaque. */
export function parseHex(hex: string): [number, number, number] | undefined {
    const digits = hex.replace(/^#/, '');
    const short = digits.length === 3 || digits.length === 4;
    if (!short && digits.length !== 6 && digits.length !== 8) return undefined;
    if (!/^[0-9a-f]+$/i.test(digits)) return undefined;
    const channel = (index: number): number =>
        short ? parseInt(digits[index]!.repeat(2), 16) : parseInt(digits.slice(index * 2, index * 2 + 2), 16);
    return [channel(0), channel(1), channel(2)];
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
    const [r, g, b] = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: number, b: number): number {
    const [light, dark] = a >= b ? [a, b] : [b, a];
    return (light + 0.05) / (dark + 0.05);
}

/** Near-black rather than black: a flat #000 on a saturated colour reads as a hole. */
const INK = '#10233b';
const PAPER = '#ffffff';

/**
 * The text colour to put on `background` — whichever of near-black and white the eye can read
 * better. An unparseable colour answers white, which is what the stylesheet assumed before any of
 * this was measured.
 */
export function readableText(background: string): string {
    const rgb = parseHex(background);
    if (!rgb) return PAPER;
    const luminance = relativeLuminance(rgb);
    const onInk = contrastRatio(luminance, relativeLuminance(parseHex(INK)!));
    const onPaper = contrastRatio(luminance, relativeLuminance(parseHex(PAPER)!));
    return onInk >= onPaper ? INK : PAPER;
}
