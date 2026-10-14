// Needs a real image backend, so it lives in the GI entry (`test.gjs.mts`) and
// the fixtures are built with GdkPixbuf directly: encoding a PNG here rather
// than committing one keeps the suite readable, and going through the same
// library the backend uses means the test proves the DECODE path too.
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';

import { decodeImageBytes } from './image-backend.js';
import { displayWidth, hasTransparentBorder, processImage, renditionWidths, trimTransparentMargin } from './images.js';

/** `0xRRGGBBAA`, filled flat; `alpha: false` drops the channel entirely. */
const solid = (rgba: number, { width = 8, height = 6, alpha = true } = {}): Uint8Array => {
    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, alpha, 8, width, height);
    pixbuf.fill(rgba);
    return png(pixbuf);
};

const png = (pixbuf: GdkPixbuf.Pixbuf): Uint8Array => {
    const [ok, bytes] = pixbuf.save_to_bufferv('png', ['compression'], ['9']);
    if (!ok) throw new Error('could not encode the fixture');
    return new Uint8Array(bytes);
};

export default async () => {
    await describe('hasTransparentBorder', async () => {
        await it('sees a window shot with transparent corners as bringing its own frame', async () => {
            expect(hasTransparentBorder(solid(0xc8643200))).toBe(true);
        });

        await it('gives an opaque screenshot the page frame', async () => {
            expect(hasTransparentBorder(solid(0xc86432ff))).toBe(false);
        });

        await it('treats an image without an alpha channel as opaque', async () => {
            expect(hasTransparentBorder(solid(0x336699ff, { alpha: false }))).toBe(false);
        });

        await it('counts a transparent border with an opaque centre', async () => {
            const framed = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 8, 6);
            framed.fill(0x00000000);
            const centre = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 4, 2);
            centre.fill(0xffffffff);
            centre.copy_area(0, 0, 4, 2, framed, 2, 2);
            expect(hasTransparentBorder(png(framed))).toBe(true);
        });
    });

    await describe('trimTransparentMargin', async () => {
        await it('drops rows and columns no pixel paints at all', async () => {
            const framed = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 8, 6);
            framed.fill(0x00000000);
            const centre = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 4, 2);
            centre.fill(0xffffffff);
            centre.copy_area(0, 0, 4, 2, framed, 2, 2);

            const trimmed = trimTransparentMargin(decodeImageBytes(png(framed)));
            expect(trimmed.width).toBe(4);
            expect(trimmed.height).toBe(2);
        });

        await it('keeps the shadow: a faintly painted pixel is not empty', async () => {
            const shadowed = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 8, 6);
            shadowed.fill(0x00000010);

            const trimmed = trimTransparentMargin(decodeImageBytes(png(shadowed)));
            expect(trimmed.width).toBe(8);
            expect(trimmed.height).toBe(6);
        });

        await it('leaves an image without a transparent margin untouched', async () => {
            const trimmed = trimTransparentMargin(decodeImageBytes(solid(0x336699ff)));
            expect(trimmed.width).toBe(8);
            expect(trimmed.height).toBe(6);
        });
    });

    await describe('processImage', async () => {
        await it('writes every format at every rendition width and reports the intrinsic size', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'gjsify-site-images-'));
            const source = join(dir, 'shot.png');
            const wide = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 1200, 600);
            wide.fill(0x336699ff);
            wide.savev(source, 'png', ['compression'], ['9']);

            const processed = await processImage(source, 'misc-shot', {
                outDir: join(dir, 'out'),
                cacheDir: join(dir, 'cache'),
                urlBase: '/assets/',
            });

            // 1280 and 2560 are above the source, so `renditionWidths` keeps 640 and the source's own 1200.
            expect(processed.width).toBe(1200);
            expect(processed.height).toBe(600);
            expect(processed.displayWidth).toBe(1200);
            expect(processed.formats.avif.map((file) => file.width)).toStrictEqual([640, 1200]);
            expect(processed.formats.png[0]?.url).toBe('/assets/misc-shot-640.png');
            expect(processed.frameless).toBe(false);

            const written = (await readdir(join(dir, 'out'))).sort();
            expect(written.length).toBe(6);
            expect(written.includes('misc-shot-1200.webp')).toBe(true);
        });

        await it('crops the transparent margin before it measures the artwork', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'gjsify-site-trim-'));
            const source = join(dir, 'window.png');
            const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 1000, 800);
            canvas.fill(0x00000000);
            const window = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 800, 400);
            window.fill(0x336699ff);
            window.copy_area(0, 0, 800, 400, canvas, 100, 200);
            canvas.savev(source, 'png', ['compression'], ['9']);

            const processed = await processImage(source, 'window', {
                outDir: join(dir, 'out'),
                cacheDir: join(dir, 'cache'),
                urlBase: '/assets/',
            });

            expect(processed.width).toBe(800);
            expect(processed.height).toBe(400);
            // Every corner of the cropped artwork is painted, so the page frames it after all.
            expect(processed.frameless).toBe(false);
        });
    });

    await describe('renditionWidths', async () => {
        await it('never upscales and keeps the source width when it is the largest that fits', async () => {
            expect(renditionWidths(1200)).toStrictEqual([640, 1200]);
            expect(renditionWidths(300)).toStrictEqual([300]);
            expect(renditionWidths(4000)).toStrictEqual([640, 1280, 2560]);
        });
    });

    await describe('displayWidth', async () => {
        await it('caps at the display width so a 2× source stays a 1× box', async () => {
            expect(displayWidth(2560)).toBe(1280);
            expect(displayWidth(1280)).toBe(1280);
            expect(displayWidth(900)).toBe(900);
        });
    });
};
