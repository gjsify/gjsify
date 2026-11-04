import type { Size } from './limits.js';

/** Beyond this the pixels are guessed rather than shown; the listing refuses instead of shipping a blur. */
export const MAX_UPSCALE = 2;

export interface Fit {
    scale: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The largest placement of `source` inside `box` that keeps the aspect ratio, centred. */
export function fitInto(source: Size, box: Size): Fit {
    const scale = Math.min(box.width / source.width, box.height / source.height);
    const width = Math.min(box.width, Math.max(1, Math.round(source.width * scale)));
    const height = Math.min(box.height, Math.max(1, Math.round(source.height * scale)));
    return { scale, x: Math.floor((box.width - width) / 2), y: Math.floor((box.height - height) / 2), width, height };
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` or `#rrggbb` as `0xRRGGBB`; anything else (alpha forms included) is `undefined`. */
export function parseHexColor(value: string | undefined): number | undefined {
    if (!value || !HEX.test(value)) return undefined;
    const digits = value.slice(1);
    const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
    return Number.parseInt(full, 16);
}

export type Placement = { ok: true; fit: Fit } | { ok: false; reason: string };

/** Letterbox placement of `source` on a `box` canvas, or the reason a clean result is impossible. */
export function planPlacement(source: Size, box: Size): Placement {
    const fit = fitInto(source, box);
    if (fit.scale > MAX_UPSCALE) {
        return {
            ok: false,
            reason: `${source.width}x${source.height} would be enlarged ${fit.scale.toFixed(1)}x to fit ${box.width}x${box.height} (limit ${MAX_UPSCALE}x)`,
        };
    }
    return { ok: true, fit };
}
