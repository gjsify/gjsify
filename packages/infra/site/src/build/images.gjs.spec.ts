// Needs a real image backend, so it lives in the GI entry (`test.gjs.mts`) and
// the fixtures are built with GdkPixbuf directly: encoding a PNG here rather
// than committing one keeps the suite readable, and going through the same
// library the backend uses means the test proves the DECODE path too.
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';

import { hasTransparentBorder, imageSlug, processImage, renditionWidths } from './images.js';

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

    await describe('processImage', async () => {
        await it('writes every format at every rendition width and reports the intrinsic size', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'gjsify-site-images-'));
            const source = join(dir, 'shot.png');
            const wide = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 1200, 600);
            wide.fill(0x336699ff);
            wide.savev(source, 'png', ['compression'], ['9']);

            const processed = await processImage(source, 'misc/shot.png', {
                outDir: join(dir, 'out'),
                cacheDir: join(dir, 'cache'),
                urlBase: '/assets/',
            });

            // 1440 is above the source, so `renditionWidths` keeps 480, 960 and the source's own 1200.
            expect(processed.width).toBe(1200);
            expect(processed.height).toBe(600);
            expect(processed.formats.avif.map((file) => file.width)).toStrictEqual([480, 960, 1200]);
            expect(processed.formats.png[0]?.url).toBe('/assets/misc-shot-480.png');
            expect(processed.frameless).toBe(false);

            const written = (await readdir(join(dir, 'out'))).sort();
            expect(written.length).toBe(9);
            expect(written.includes('misc-shot-960.webp')).toBe(true);
        });
    });

    await describe('renditionWidths', async () => {
        await it('never upscales and keeps the source width when it is the largest that fits', async () => {
            expect(renditionWidths(1200)).toStrictEqual([480, 960, 1200]);
            expect(renditionWidths(300)).toStrictEqual([300]);
            expect(renditionWidths(4000)).toStrictEqual([480, 960, 1440]);
        });
    });

    await describe('imageSlug', async () => {
        await it('flattens a repo-relative path into one filename stem', async () => {
            expect(imageSlug('misc/screenshots/Editor 1.png')).toBe('misc-screenshots-editor-1');
        });
    });
};
