// CSS color parser for Canvas 2D context
// Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value

export interface RGBA {
    r: number; // 0-1
    g: number; // 0-1
    b: number; // 0-1
    a: number; // 0-1
}

// CSS named colors (all 148 standard colors)
const NAMED_COLORS: Record<string, string> = {
    aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
    azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
    blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
    burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
    coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
    cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
    darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
    darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
    darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
    darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
    deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
    dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
    fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
    goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
    grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
    indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
    lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
    lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
    lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
    lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
    lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
    linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
    mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
    mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
    mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1',
    moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6',
    olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500',
    orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
    palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
    pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080',
    rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
    saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57',
    seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb',
    slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
    springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080',
    thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee',
    wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
    yellowgreen: '#9acd32',
    transparent: '#00000000',
};

/**
 * Parse a CSS color string into RGBA components (0-1 range).
 * Supports: #rgb, #rrggbb, #rgba, #rrggbbaa, rgb(), rgba(), hsl(), hsla(), named colors, 'transparent'.
 *
 * Also handles Excalibur's non-standard HSL format where h/s/l are all in 0-1 range (not degrees/%).
 * Excalibur's Color.toString() returns `hsla(h, s, l, a)` with values in 0-1 normalized form
 * (e.g. Color.White → "hsla(0, 0, 1, 1)", Color.Black → "hsla(0, 0, 0, 1)").
 */
export function parseColor(color: string): RGBA | null {
    if (!color || typeof color !== 'string') return null;

    const trimmed = color.trim().toLowerCase();

    // Named colors
    const named = NAMED_COLORS[trimmed];
    if (named) return parseHex(named);

    // Hex formats
    if (trimmed.startsWith('#')) return parseHex(trimmed);

    // rgb()/rgba()
    const rgbMatch = trimmed.match(
        /^rgba?\(\s*(\d+(?:\.\d+)?%?)\s*[,\s]\s*(\d+(?:\.\d+)?%?)\s*[,\s]\s*(\d+(?:\.\d+)?%?)\s*(?:[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/
    );
    if (rgbMatch) {
        return {
            r: parseComponent(rgbMatch[1], 255) / 255,
            g: parseComponent(rgbMatch[2], 255) / 255,
            b: parseComponent(rgbMatch[3], 255) / 255,
            a: rgbMatch[4] !== undefined ? parseComponent(rgbMatch[4], 1) : 1,
        };
    }

    // hsl()/hsla() — handles both standard CSS (degrees, %) and Excalibur's 0-1 normalized form.
    // Heuristic: if s/l have no % and are ≤ 1, treat as 0-1 normalized; if h > 1, treat as degrees.
    const hslMatch = trimmed.match(
        /^hsla?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(%)?\s*[,\s]\s*(\d+(?:\.\d+)?)(%)?\s*(?:[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/
    );
    if (hslMatch) {
        let h = parseFloat(hslMatch[1]);
        let s = parseFloat(hslMatch[2]);
        const sPct = hslMatch[3] === '%';
        let l = parseFloat(hslMatch[4]);
        const lPct = hslMatch[5] === '%';
        const a = hslMatch[6] !== undefined ? parseComponent(hslMatch[6], 1) : 1;

        // Normalize h to 0-1 range: if > 1, it's degrees (0-360)
        if (h > 1) h /= 360;
        // Normalize s to 0-1 range
        if (sPct) s /= 100;
        else if (s > 1) s /= 100;
        // Normalize l to 0-1 range
        if (lPct) l /= 100;
        else if (l > 1) l /= 100;

        return hslToRGBA(h, s, l, Math.max(0, Math.min(1, a)));
    }

    return null;
}

function parseHex(hex: string): RGBA | null {
    const h = hex.slice(1);
    let r: number, g: number, b: number, a = 1;

    if (h.length === 3) {
        r = parseInt(h[0] + h[0], 16) / 255;
        g = parseInt(h[1] + h[1], 16) / 255;
        b = parseInt(h[2] + h[2], 16) / 255;
    } else if (h.length === 4) {
        r = parseInt(h[0] + h[0], 16) / 255;
        g = parseInt(h[1] + h[1], 16) / 255;
        b = parseInt(h[2] + h[2], 16) / 255;
        a = parseInt(h[3] + h[3], 16) / 255;
    } else if (h.length === 6) {
        r = parseInt(h.slice(0, 2), 16) / 255;
        g = parseInt(h.slice(2, 4), 16) / 255;
        b = parseInt(h.slice(4, 6), 16) / 255;
    } else if (h.length === 8) {
        r = parseInt(h.slice(0, 2), 16) / 255;
        g = parseInt(h.slice(2, 4), 16) / 255;
        b = parseInt(h.slice(4, 6), 16) / 255;
        a = parseInt(h.slice(6, 8), 16) / 255;
    } else {
        return null;
    }

    return { r, g, b, a };
}

function parseComponent(value: string, max: number): number {
    if (value.endsWith('%')) {
        return (parseFloat(value) / 100) * max;
    }
    return parseFloat(value);
}

function hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

function hslToRGBA(h: number, s: number, l: number, a: number): RGBA {
    let r: number, g: number, b: number;
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r, g, b, a };
}

/** Default color: opaque black */
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
/** Transparent black */
export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
