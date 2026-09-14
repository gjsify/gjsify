// The Windows icon container, in its two spellings: the `.ico` FILE, and the
// pair of resource types (`RT_GROUP_ICON`, `RT_ICON`) the same bytes take inside
// a PE image.
//
// WHY BOTH. Explorer, the Start menu, the taskbar and the Alt-Tab list all ask
// the EXECUTABLE for its icon, so the launcher `pe-launcher.ts` emits carries the
// resource form. The `.ico` file form is what an independent reader opens —
// Pillow, `icotool`, ImageMagick — and it is how `verify-program-dir.py`
// reassembles what it extracted from the `.rsrc` section to hand it to one.
//
// THE RESOURCE FORM IS NOT THE FILE FORM, and the difference is the one thing
// worth knowing about this format. An `.ico` is an `ICONDIR` whose entries end in
// a 4-byte `dwImageOffset` into the file. Inside a PE the images are separate
// `RT_ICON` resources, so the group directory's entries end in a 2-byte `nId`
// naming the resource instead — `GRPICONDIRENTRY` is 14 bytes where
// `ICONDIRENTRY` is 16. Writing the file form into `RT_GROUP_ICON` produces a
// resource Windows reads as a group with garbage ids, and the shell shows the
// generic icon with no error anywhere.
//
// PNG PAYLOADS AT EVERY SIZE. Since Windows Vista an image entry may be a whole
// PNG file rather than a BMP `BITMAPINFOHEADER` + pixel rows + AND mask, and that
// is what removes the need for a BMP encoder here. Confirmed against two readers
// on this workstation rather than trusted: Pillow 12.3 and `icotool -l`
// (icoutils 0.32) both list a six-entry PNG-only `.ico` at 16/24/32/48/64/256
// as six 32-bit images. The 256 entry is the one every guide says MUST be PNG
// (a BMP at that size is 256 KiB); the smaller ones are PNG for the same reason
// and because one encoding is one code path. Whether Windows 11's shell draws the
// small PNG entries at the same quality as BMP ones is a VM measurement this
// tree has not made — see the report that lands this file.
//
// THE SIZES are Microsoft's list for a classic desktop application icon — 16,
// 24, 32, 48 and 256, "the full set" in the *Icons (Design basics)* guidance —
// plus 64, which the same page names for the 200 % scaling of the 32 slot. The
// Start menu and the taskbar pick from these by DPI; a set missing 16 or 32
// renders the entry as a scaled 256, which is the blur every reader has seen on a
// half-finished port.

import { concatBytes } from './bytes.js';
import type { AppIconRasters } from './icons.js';
import { readPngSize } from './icons.js';

/** The edge lengths a Windows application icon carries. Ascending, so the entry order is too. */
export const ICO_SIZES: readonly number[] = [16, 24, 32, 48, 64, 256];

/** `RT_ICON` and `RT_GROUP_ICON`: the two resource type ids. */
export const RT_ICON = 3;
export const RT_GROUP_ICON = 14;

/** The ICONDIRENTRY / GRPICONDIRENTRY head shared by both forms: 8 bytes. */
function entryHead(size: number): Uint8Array {
    const head = Buffer.alloc(8);
    // 0 means 256 in the one-byte width/height fields — the format predates 256
    // px icons and a byte cannot hold the number.
    head.writeUInt8(size >= 256 ? 0 : size, 0); // bWidth
    head.writeUInt8(size >= 256 ? 0 : size, 1); // bHeight
    head.writeUInt8(0, 2); // bColorCount — 0 for anything past 8 bpp
    head.writeUInt8(0, 3); // bReserved
    head.writeUInt16LE(1, 4); // wPlanes
    head.writeUInt16LE(32, 6); // wBitCount — what a PNG-backed entry declares
    return new Uint8Array(head);
}

/** The sizes in ascending order, each one asserted present and square at that size. */
function entries(icon: AppIconRasters): { size: number; png: Uint8Array }[] {
    const out: { size: number; png: Uint8Array }[] = [];
    for (const size of ICO_SIZES) {
        const png = icon.png.get(size);
        if (png === undefined) {
            throw new Error(
                `gjsify ship: the Windows icon needs a ${size} px image and the raster set has none — ` +
                    `\`resolveAppIcon\` was asked for the wrong sizes (it has ${[...icon.png.keys()].join(', ')}).`,
            );
        }
        const { width, height } = readPngSize(png, `the ${size} px icon image`);
        if (width !== size || height !== size) {
            throw new Error(`gjsify ship: the image keyed ${size} in the icon raster set is ${width}×${height}.`);
        }
        if (size > 256) {
            // The one-byte size fields cannot say more than 256, and Windows reads
            // nothing larger from an icon.
            throw new Error(`gjsify ship: a Windows icon image cannot be ${size} px — 256 is the format's ceiling.`);
        }
        out.push({ size, png });
    }
    return out;
}

/**
 * The `.ico` file: `ICONDIR`, one `ICONDIRENTRY` per image, then the PNGs.
 */
export function buildIco(icon: AppIconRasters): Uint8Array {
    const images = entries(icon);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // idReserved
    header.writeUInt16LE(1, 2); // idType — 1 is an icon, 2 a cursor
    header.writeUInt16LE(images.length, 4);
    const directory: Uint8Array[] = [];
    let offset = 6 + 16 * images.length;
    for (const { size, png } of images) {
        const tail = Buffer.alloc(8);
        tail.writeUInt32LE(png.length, 0); // dwBytesInRes
        tail.writeUInt32LE(offset, 4); // dwImageOffset — a FILE offset
        directory.push(entryHead(size), new Uint8Array(tail));
        offset += png.length;
    }
    return concatBytes([new Uint8Array(header), ...directory, ...images.map((image) => image.png)]);
}

/** What the PE resource directory carries: the group, and the images the group names by id. */
export interface IconResources {
    /** The `RT_GROUP_ICON` payload: `GRPICONDIR` with 14-byte entries naming `icons` by 1-based id. */
    group: Uint8Array;
    /** The `RT_ICON` payloads, in id order: `icons[i]` is resource id `i + 1`. */
    icons: readonly Uint8Array[];
}

/**
 * The same images as resources: `RT_ICON` id `n` is the n-th image, and the
 * `RT_GROUP_ICON` names them by that id.
 *
 * Ids start at 1 because resource id 0 is never used by convention and some
 * readers treat it as "no icon".
 */
export function iconResources(icon: AppIconRasters): IconResources {
    const images = entries(icon);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    const directory: Uint8Array[] = [];
    images.forEach(({ size, png }, index) => {
        const tail = Buffer.alloc(6);
        tail.writeUInt32LE(png.length, 0); // dwBytesInRes
        tail.writeUInt16LE(index + 1, 4); // nId — the RT_ICON resource, NOT an offset
        directory.push(entryHead(size), new Uint8Array(tail));
    });
    return { group: concatBytes([new Uint8Array(header), ...directory]), icons: images.map((image) => image.png) };
}
