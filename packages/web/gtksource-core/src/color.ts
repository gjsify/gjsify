// CSS colour values as style schemes write them, to the signed 32-bit ARGB integers Android's
// `Paint` and colour spans take.

/**
 * `#rgb`, `#rrggbb` and `#rrggbbaa` (CSS puts the alpha LAST: Learn6502's `#00000018` is a
 * barely-there black). Anything else — named colours, `rgb()` — is `undefined`; a scheme
 * that uses them loses that colour rather than crashing the editor.
 */
export function parseColor(value: string): number | undefined {
    const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
    if (!match) return undefined;
    let hex = match[1];
    if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('');
    if (hex.length === 6) hex += 'ff';
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    const alpha = parseInt(hex.slice(6, 8), 16);
    return (alpha << 24) | (red << 16) | (green << 8) | blue | 0;
}
