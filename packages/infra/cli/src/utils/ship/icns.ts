// The macOS icon container — what `iconutil -c icns` produces from an
// `.iconset`, written here from the same rasters the Windows icon uses.
//
// THE FORMAT is a big-endian tagged container: an 8-byte header (`icns`, total
// length), then elements, each an 8-byte head (4-char type, length INCLUDING the
// head) and its data. Since Mac OS X 10.7 an element's data may be a whole PNG
// file, one element type per (size, scale) pair — which is what lets this file
// be written with no image encoder of its own.
//
// THE ELEMENT TABLE is Apple's iconset naming turned into type codes, and it is
// cited to two readers rather than typed from memory: Pillow's
// `IcnsImagePlugin.SIZES` (12.3) maps exactly these ten types to these (size,
// scale) pairs, and `iconutil` on macOS 15 — see the report that lands this file
// — accepts the result. `icp4`/`icp5` (16 and 32 at 1x) are the two Pillow's
// WRITER omits and its READER accepts; they are included because Apple's own
// `iconutil` writes them for `icon_16x16.png` and `icon_32x32.png`, and the Finder
// list view and the Dock's smallest sizes are drawn from exactly those two.
//
// TEN ELEMENTS OVER SEVEN SIZES: a `@2x` element and a 1x element of twice the
// point size hold the SAME pixels (`ic11` = 16@2x and `icp5` = 32@1x are both 32 px
// PNGs), so the raster map is asked for seven sizes and three of them are written
// twice. Writing all ten rather than the seven distinct sizes is what makes the
// file complete in the Finder's terms: it looks up by (size, scale), not by pixel
// count.
//
// `TOC ` FIRST, as `iconutil` and Pillow both write it: an optional index of the
// elements that follow, which lets a reader seek without walking. Optional to
// read, cheap to write, and its absence is the first thing a strict reader
// notices.
//
// WHAT NO LINUX READER HERE CAN SAY. `icns2png` (libicns 0.8.1) parses `ic08`,
// `ic09` and `ic10` and refuses the other seven types by name — measured on this
// workstation, so it reads three of ten and is not an oracle for the file. Pillow
// reads all ten and is NOT in the CI image. `verify-app-plist.py` therefore reads
// the container with CPython `struct` and checks each PNG's IHDR against the type's
// size, which is one independent family; the `iconutil` run on macOS is the
// reader with authority, and it is a VM measurement, not a CI leg.

import { concatBytes } from './bytes.js';
import type { AppIconRasters } from './icons.js';
import { readPngSize } from './icons.js';

/** One element of the container: Apple's type code and the pixel size of the PNG it holds. */
export interface IcnsElement {
    readonly type: string;
    readonly size: number;
    /** The `.iconset` filename `iconutil` gives this element — the reader's spelling, for messages. */
    readonly iconset: string;
}

/** The ten PNG-backed element types of a modern application icon, in `iconutil`'s order. */
export const ICNS_ELEMENTS: readonly IcnsElement[] = [
    { type: 'icp4', size: 16, iconset: 'icon_16x16.png' },
    { type: 'ic11', size: 32, iconset: 'icon_16x16@2x.png' },
    { type: 'icp5', size: 32, iconset: 'icon_32x32.png' },
    { type: 'ic12', size: 64, iconset: 'icon_32x32@2x.png' },
    { type: 'ic07', size: 128, iconset: 'icon_128x128.png' },
    { type: 'ic13', size: 256, iconset: 'icon_128x128@2x.png' },
    { type: 'ic08', size: 256, iconset: 'icon_256x256.png' },
    { type: 'ic14', size: 512, iconset: 'icon_256x256@2x.png' },
    { type: 'ic09', size: 512, iconset: 'icon_512x512.png' },
    { type: 'ic10', size: 1024, iconset: 'icon_512x512@2x.png' },
];

/** The distinct pixel sizes the ten elements need — what the layout asks the raster step for. */
export const ICNS_SIZES: readonly number[] = [...new Set(ICNS_ELEMENTS.map((element) => element.size))].sort(
    (a, b) => a - b,
);

/** An element head: the four-character type and the big-endian length including these 8 bytes. */
function head(type: string, length: number): Uint8Array {
    const out = Buffer.alloc(8);
    out.write(type, 0, 'latin1');
    out.writeUInt32BE(length, 4);
    return new Uint8Array(out);
}

/** The `.icns` file, `TOC ` first, then the ten elements in {@link ICNS_ELEMENTS} order. */
export function buildIcns(icon: AppIconRasters): Uint8Array {
    const elements = ICNS_ELEMENTS.map((element) => {
        const png = icon.png.get(element.size);
        if (png === undefined) {
            throw new Error(
                `gjsify ship: the macOS icon needs a ${element.size} px image (${element.iconset}) and the raster ` +
                    `set has none — \`resolveAppIcon\` was asked for the wrong sizes.`,
            );
        }
        const { width, height } = readPngSize(png, `the ${element.size} px icon image`);
        if (width !== element.size || height !== element.size) {
            throw new Error(
                `gjsify ship: the image keyed ${element.size} in the icon raster set is ${width}×${height}.`,
            );
        }
        return { ...element, png };
    });
    const toc = concatBytes([
        head('TOC ', 8 + 8 * elements.length),
        ...elements.map((element) => head(element.type, 8 + element.png.length)),
    ]);
    const body = elements.map((element) => concatBytes([head(element.type, 8 + element.png.length), element.png]));
    const total = 8 + toc.length + body.reduce((sum, element) => sum + element.length, 0);
    return concatBytes([head('icns', total), toc, ...body]);
}
