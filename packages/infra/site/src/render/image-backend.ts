// The ONE image backend: GdkPixbuf. Decode, alpha probe, downscale, encode —
// everything `images.ts` needs, behind a plain-object seam so the rest of the
// build never names a library.
//
// Why GdkPixbuf rather than a JS encoder: it is reachable from EVERY runtime
// gjsify builds for, and it is the only thing in that set that is. Under
// `--app gjs` the `gi://` import lowers to GJS's own GI loader; under `--app
// node` the bundler rewrites it to the `@gjsify/node-gi` reverse bridge (ADR
// 0030), which is also what bun and deno run. So a site build is not a Node
// site build or a GJS site build — it is the same code on whichever runtime
// `gjsify` itself runs on. A `sharp` dependency would have inverted that: a
// native Node-API addon, no GJS story at all.
//
// AVIF/WebP writing comes from gdk-pixbuf's loader set (glycin on current
// GNOME), not from this package, so `assertEncodable` reports a MISSING LOADER
// by name instead of writing a 0-byte file. One format is deliberately absent
// from `ImageFormat`: JPEG. `save_to_bufferv('jpeg', …)` fails on an RGBA
// pixbuf ("the encoder or decoder for Jpeg does not support the color type
// `Rgba8`"), and screenshots of a window are RGBA.
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';

export type ImageFormat = 'avif' | 'webp' | 'png';

/** Encoder options per format, matching what the renditions were tuned to. */
const ENCODER: Record<ImageFormat, { keys: string[]; values: string[] }> = {
    avif: { keys: ['quality'], values: ['55'] },
    webp: { keys: ['quality'], values: ['80'] },
    png: { keys: ['compression'], values: ['9'] },
};

/** A rectangle in pixels, as `opaqueBounds` reports it and `cropped` takes it. */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A decoded raster, immutable: `resizedToWidth` and `cropped` answer a new one. */
export interface RasterImage {
    readonly width: number;
    readonly height: number;
    /** 0–255; an image without an alpha channel answers 255 everywhere. */
    alphaAt(x: number, y: number): number;
    /**
     * The smallest rectangle holding every pixel whose alpha reaches `threshold`, or `null` when no
     * pixel does. An image without an alpha channel answers its whole area.
     */
    opaqueBounds(threshold: number): Rect | null;
    cropped(rect: Rect): RasterImage;
    /** Keeps the aspect ratio. Never enlarges: a width at or above this one answers the same image. */
    /** `nearest` keeps pixel art's hard edges; the default resamples smoothly. */
    resizedToWidth(width: number, filter?: 'smooth' | 'nearest'): RasterImage;
    encode(format: ImageFormat): Uint8Array;
}

let writableFormats: Set<string> | undefined;

/** Throws naming the loader when gdk-pixbuf on this system cannot WRITE the format. */
function assertEncodable(format: ImageFormat): void {
    const writable = (writableFormats ??= new Set(
        GdkPixbuf.Pixbuf.get_formats()
            .filter((entry) => entry.is_writable())
            .map((entry) => entry.get_name())
            .filter((name): name is string => name !== null),
    ));
    if (writable.has(format)) return;
    throw new Error(
        `gdk-pixbuf on this system cannot write ${format.toUpperCase()} — install the gdk-pixbuf loader for it ` +
            `(GNOME ships AVIF and WebP through glycin). Writable here: ${[...writable].sort().join(', ')}.`,
    );
}

function wrap(pixbuf: GdkPixbuf.Pixbuf): RasterImage {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    return {
        width,
        height,
        alphaAt(x, y) {
            if (!pixbuf.get_has_alpha()) return 255;
            const pixels = pixbuf.get_pixels();
            return pixels[y * pixbuf.get_rowstride() + x * pixbuf.get_n_channels() + 3] ?? 255;
        },
        opaqueBounds(threshold) {
            if (!pixbuf.get_has_alpha()) return { x: 0, y: 0, width, height };
            // The whole buffer once, not a call per pixel: a 2560px screenshot is seven million
            // samples, and `get_pixels` copies the buffer out of GI on every call.
            const pixels = pixbuf.get_pixels();
            const stride = pixbuf.get_rowstride();
            const channels = pixbuf.get_n_channels();
            let top = -1;
            let bottom = -1;
            let left = width;
            let right = -1;
            for (let y = 0; y < height; y++) {
                const row = y * stride;
                let first = -1;
                let last = -1;
                for (let x = 0; x < width; x++) {
                    if ((pixels[row + x * channels + 3] ?? 255) < threshold) continue;
                    if (first === -1) first = x;
                    last = x;
                }
                if (first === -1) continue;
                if (top === -1) top = y;
                bottom = y;
                if (first < left) left = first;
                if (last > right) right = last;
            }
            if (top === -1) return null;
            return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
        },
        cropped(rect) {
            const sub = pixbuf.new_subpixbuf(rect.x, rect.y, rect.width, rect.height);
            if (!sub) throw new Error(`Could not crop an image to ${rect.width}x${rect.height}`);
            return wrap(sub);
        },
        resizedToWidth(target, filter = 'smooth') {
            if (target >= width) return wrap(pixbuf);
            const scaled = pixbuf.scale_simple(
                target,
                Math.max(1, Math.round((height * target) / width)),
                // HYPER over BILINEAR: these are large screenshots scaled far
                // down, where bilinear drops thin UI lines (1px borders, text
                // stems) that the page is meant to show.
                filter === 'nearest' ? GdkPixbuf.InterpType.NEAREST : GdkPixbuf.InterpType.HYPER,
            );
            if (!scaled) throw new Error(`Could not scale an image to ${target}px`);
            return wrap(scaled);
        },
        encode(format) {
            assertEncodable(format);
            const { keys, values } = ENCODER[format];
            const [ok, bytes] = pixbuf.save_to_bufferv(format, keys, values);
            if (!ok || !bytes?.length) throw new Error(`Encoding ${format.toUpperCase()} produced no data`);
            return new Uint8Array(bytes);
        },
    };
}

export function decodeImageFile(path: string): RasterImage {
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
    if (!pixbuf) throw new Error(`Could not decode ${path}`);
    return wrap(pixbuf);
}

export function decodeImageBytes(bytes: Uint8Array): RasterImage {
    const loader = new GdkPixbuf.PixbufLoader();
    loader.write(bytes);
    loader.close();
    const pixbuf = loader.get_pixbuf();
    if (!pixbuf) throw new Error('Could not decode an image from memory');
    return wrap(pixbuf);
}

/** Rasterises an SVG document at its own size, through the same loader set as the screenshots. */
export function svgToPng(svg: string): Uint8Array {
    return decodeImageBytes(new TextEncoder().encode(svg)).encode('png');
}
