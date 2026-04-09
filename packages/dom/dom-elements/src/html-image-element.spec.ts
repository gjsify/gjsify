// HTMLImageElement lifecycle tests — verifies the src → onload → pixbuf
// chain Excalibur relies on, plus the native GJS extensions used by
// @gjsify/canvas2d-core drawImage.
//
// Ported from refs/happy-dom/packages/happy-dom/test/nodes/html-image-element/
// HTMLImageElement.test.ts (MIT, David Ortner) plus custom cases that
// lock in compatibility with Excalibur's ImageSource.load pattern:
//     const image = new Image();
//     image.onload = () => futureResolve();
//     image.src = url;
//     await future;
// (refs/excalibur/src/engine/graphics/image-source.ts:226-273)

import { describe, it, expect } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';

import { HTMLImageElement, Image } from '@gjsify/dom-elements';

// ── Test fixture setup ────────────────────────────────────────────────────
//
// Generates a 2×2 RGBA test PNG in /tmp at module load. Each pixel has a
// distinct color (red/green/blue/white) so get-pixel tests can verify
// byte order. Cleaned up by /tmp rotation; no explicit teardown needed.

const FIXTURE_DIR = GLib.get_tmp_dir();
const FIXTURE_PATH = GLib.build_filenamev([FIXTURE_DIR, 'gjsify-test-2x2.png']);
const FIXTURE_URI = 'file://' + FIXTURE_PATH;

function writeFixturePng(): void {
    // 2×2 RGBA raw pixel buffer:
    //   (0,0) red   (1,0) green
    //   (0,1) blue  (1,1) white
    const pixels = new Uint8Array([
        255, 0, 0, 255,    0, 255, 0, 255,
        0, 0, 255, 255,  255, 255, 255, 255,
    ]);
    // GdkPixbuf.Pixbuf.new_from_bytes expects row-major, w*4 stride for RGBA.
    const bytes = GLib.Bytes.new(pixels);
    const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
        bytes,
        GdkPixbuf.Colorspace.RGB,
        true,  // has_alpha
        8,     // bits_per_sample
        2,     // width
        2,     // height
        8,     // rowstride (2 px * 4 bytes)
    );
    pixbuf.savev(FIXTURE_PATH, 'png', [], []);
}

writeFixturePng();

export default async () => {
    await describe('HTMLImageElement', async () => {

        await describe('constructor + static Image alias', async () => {
            await it('new HTMLImageElement() creates an empty image', async () => {
                const img = new HTMLImageElement();
                expect(img.complete).toBe(false);
                expect(img.naturalWidth).toBe(0);
                expect(img.naturalHeight).toBe(0);
                expect(img.src).toBe('');
            });

            await it('new Image() yields an HTMLImageElement instance', async () => {
                const img = new Image();
                expect(img instanceof HTMLImageElement).toBe(true);
            });
        });

        await describe('src setter — file:// loading', async () => {
            await it('loads a file:// URL synchronously and sets natural dimensions', async () => {
                const img = new HTMLImageElement();
                img.src = FIXTURE_URI;
                expect(img.complete).toBe(true);
                expect(img.naturalWidth).toBe(2);
                expect(img.naturalHeight).toBe(2);
                expect(img.isPixbuf()).toBe(true);
            });

            await it('fires the load event (sync dispatch)', async () => {
                const img = new HTMLImageElement();
                let loaded = false;
                img.addEventListener('load', () => { loaded = true; });
                img.src = FIXTURE_URI;
                expect(loaded).toBe(true);
            });

            await it('fires the error event for non-existent files', async () => {
                const img = new HTMLImageElement();
                let errored = false;
                img.addEventListener('error', () => { errored = true; });
                img.src = 'file:///nonexistent/definitely/not/here.png';
                expect(errored).toBe(true);
                expect(img.complete).toBe(true);
                expect(img.isPixbuf()).toBe(false);
            });

            await it('fires error immediately for http:// URLs (not supported in GJS)', async () => {
                const img = new HTMLImageElement();
                let errored = false;
                img.addEventListener('error', () => { errored = true; });
                img.src = 'http://example.com/img.png';
                expect(errored).toBe(true);
                expect(img.complete).toBe(true);
            });
        });

        await describe('Excalibur.ImageSource.load pattern — handler before src', async () => {
            // This is the canonical pattern Excalibur uses in
            // refs/excalibur/src/engine/graphics/image-source.ts:247-252.
            // The handler must be set BEFORE src so the sync dispatch fires
            // it and the awaited promise resolves correctly.
            await it('onload-set-then-src-set resolves the future', async () => {
                const img = new HTMLImageElement();
                const future = new Promise<void>((resolve) => {
                    img.onload = () => resolve();
                });
                img.src = FIXTURE_URI;
                // Sync dispatch fires onload before returning from src=.
                await future;
                expect(img.complete).toBe(true);
                expect(img.naturalWidth).toBe(2);
            });

            await it('onload registered AFTER src is set does NOT fire', async () => {
                // Matches browser semantics: the load event is a one-shot
                // dispatch — registering a listener after it fires does not
                // retroactively invoke it.
                const img = new HTMLImageElement();
                img.src = FIXTURE_URI;
                expect(img.complete).toBe(true);
                let fired = false;
                img.onload = () => { fired = true; };
                // Give microtasks a chance to fire (they won't).
                await new Promise<void>((r) => r());
                expect(fired).toBe(false);
            });
        });

        await describe('getImageData — RGBA byte order', async () => {
            await it('extracts correct pixel bytes from the loaded pixbuf', async () => {
                const img = new HTMLImageElement();
                img.src = FIXTURE_URI;
                const data = img.getImageData();
                expect(data).not.toBeNull();
                expect(data!.width).toBe(2);
                expect(data!.height).toBe(2);
                // Pixel (0,0) — red
                expect(data!.data[0]).toBe(255);
                expect(data!.data[1]).toBe(0);
                expect(data!.data[2]).toBe(0);
                expect(data!.data[3]).toBe(255);
                // Pixel (1,0) — green
                expect(data!.data[4]).toBe(0);
                expect(data!.data[5]).toBe(255);
                expect(data!.data[6]).toBe(0);
                expect(data!.data[7]).toBe(255);
                // Pixel (0,1) — blue
                expect(data!.data[8]).toBe(0);
                expect(data!.data[9]).toBe(0);
                expect(data!.data[10]).toBe(255);
                expect(data!.data[11]).toBe(255);
                // Pixel (1,1) — white
                expect(data!.data[12]).toBe(255);
                expect(data!.data[13]).toBe(255);
                expect(data!.data[14]).toBe(255);
                expect(data!.data[15]).toBe(255);
            });
        });

        await describe('src setter — data: URI loading', async () => {
            // Excalibur's Loader.onBeforeLoad() sets img.src to a data:image/png;base64,...
            // URI for the loader logo. If this fires error instead of load, the
            // _imageLoaded promise never resolves and the loader hangs forever.
            // Regression test for the GJS fix using GLib.base64_decode + Gio.MemoryInputStream.

            function makeDataUri(): string {
                // Encode the 2×2 fixture PNG as a data URI using GLib.
                const [ok, bytes] = GLib.file_get_contents(FIXTURE_PATH);
                if (!ok) throw new Error('fixture PNG not found');
                const b64 = GLib.base64_encode(bytes as unknown as Uint8Array);
                return `data:image/png;base64,${b64}`;
            }

            await it('loads a base64 PNG data URI and sets natural dimensions', async () => {
                const img = new HTMLImageElement();
                const dataUri = makeDataUri();
                img.src = dataUri;
                expect(img.complete).toBe(true);
                expect(img.naturalWidth).toBe(2);
                expect(img.naturalHeight).toBe(2);
                expect(img.isPixbuf()).toBe(true);
            });

            await it('fires load event for a base64 PNG data URI', async () => {
                const img = new HTMLImageElement();
                let loaded = false;
                img.addEventListener('load', () => { loaded = true; });
                img.src = makeDataUri();
                expect(loaded).toBe(true);
            });

            await it('Excalibur pattern: onload-then-src resolves for data URIs', async () => {
                const img = new HTMLImageElement();
                const future = new Promise<void>((resolve) => {
                    img.onload = () => resolve();
                });
                img.src = makeDataUri();
                await future;
                expect(img.complete).toBe(true);
                expect(img.naturalWidth).toBe(2);
            });

            await it('fires error for a malformed data URI (no comma)', async () => {
                const img = new HTMLImageElement();
                let errored = false;
                img.addEventListener('error', () => { errored = true; });
                img.src = 'data:image/png;base64';
                expect(errored).toBe(true);
                expect(img.complete).toBe(true);
            });

            await it('getImageData returns correct RGBA pixels from data URI', async () => {
                const img = new HTMLImageElement();
                img.src = makeDataUri();
                const data = img.getImageData();
                expect(data).not.toBeNull();
                expect(data!.width).toBe(2);
                expect(data!.height).toBe(2);
                // Pixel (0,0) — red
                expect(data!.data[0]).toBe(255);
                expect(data!.data[1]).toBe(0);
                expect(data!.data[2]).toBe(0);
                expect(data!.data[3]).toBe(255);
            });
        });

        await describe('dataset proxy — Excalibur data-original-src pattern', async () => {
            // Excalibur's ImageSource.load does:
            //   image.setAttribute('data-original-src', this.path);
            // and TextureLoader.checkImageSizeSupportedAndLog reads
            //   image.dataset.originalSrc
            // Our dataset Proxy must perform the kebab→camel case conversion.
            await it('reads a data-* attribute via camelCase dataset access', async () => {
                const img = new HTMLImageElement();
                img.setAttribute('data-original-src', 'sprites/hero.png');
                expect(img.dataset.originalSrc).toBe('sprites/hero.png');
            });

            await it('sets a data-* attribute via dataset assignment', async () => {
                const img = new HTMLImageElement();
                img.dataset.tileIndex = '42';
                expect(img.getAttribute('data-tile-index')).toBe('42');
            });

            await it('delete operator removes the data-* attribute', async () => {
                const img = new HTMLImageElement();
                img.setAttribute('data-foo', 'bar');
                delete img.dataset.foo;
                expect(img.hasAttribute('data-foo')).toBe(false);
            });

            await it('returns undefined for unset dataset keys', async () => {
                const img = new HTMLImageElement();
                expect(img.dataset.nothing).toBe(undefined);
            });
        });

        await describe('attribute-backed properties', async () => {
            await it('alt, title, crossOrigin round-trip through attributes', async () => {
                const img = new HTMLImageElement();
                img.alt = 'hero sprite';
                img.title = 'A jumping jelly';
                img.crossOrigin = 'anonymous';
                expect(img.getAttribute('alt')).toBe('hero sprite');
                expect(img.getAttribute('title')).toBe('A jumping jelly');
                expect(img.getAttribute('crossorigin')).toBe('anonymous');
                expect(img.alt).toBe('hero sprite');
                expect(img.crossOrigin).toBe('anonymous');
            });
        });
    });
};
