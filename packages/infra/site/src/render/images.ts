import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decodeImageBytes, decodeImageFile, type ImageFormat, type RasterImage } from './image-backend.js';

export type { ImageFormat };

export interface ImageFile {
    url: string;
    width: number;
}

export interface ProcessedImage {
    /** Intrinsic size of the largest rendition, for the `width`/`height` attributes. */
    width: number;
    height: number;
    /** CSS pixels the page gives this screenshot at most; the renditions above it serve HiDPI. */
    displayWidth: number;
    formats: Record<ImageFormat, ImageFile[]>;
    /** The artwork already carries its own shadow (a window shot), so the page adds no frame. */
    frameless: boolean;
}

export interface ImageOptions {
    /** Directory the renditions are published into (served below `urlBase`). */
    outDir: string;
    /** Persistent store of encoded renditions; AVIF is slow, so it is reused while the source is unchanged. */
    cacheDir: string;
    urlBase: string;
    /** `theme.imageRendering: pixelated` — nearest-neighbour renditions for pixel art. */
    pixelated?: boolean;
}

/**
 * The widest the page ever shows a screenshot, in CSS pixels. A screenshot is shown at its natural
 * width capped here and NEVER upscaled, which also settles what a "2×" source is without asking the
 * metainfo: a 2560px source fills 1280 CSS px at device-pixel-ratio 2, a 1280px one fills the same
 * box at ratio 1 and is as sharp as its artwork allows. Renditions therefore go up to twice this.
 */
export const MAX_DISPLAY_WIDTH = 1280;

const TARGET_WIDTHS = [640, MAX_DISPLAY_WIDTH, MAX_DISPLAY_WIDTH * 2];
const FORMATS: ImageFormat[] = ['avif', 'webp', 'png'];

/** Never upscales: the largest rendition is the source itself, or twice the display cap if that is smaller. */
export function renditionWidths(natural: number): number[] {
    const largest = Math.min(natural, MAX_DISPLAY_WIDTH * 2);
    const widths = new Set(TARGET_WIDTHS.filter((width) => width < largest));
    widths.add(largest);
    return [...widths].sort((a, b) => a - b);
}

/** CSS pixels this source fills: the display cap, or the source itself when it is narrower. */
export function displayWidth(natural: number): number {
    return Math.min(natural, MAX_DISPLAY_WIDTH);
}

/** Alpha below this is nothing at all: a pixel the source left empty, not the faint tail of a shadow. */
const ALPHA_EMPTY = 1;

const CORNER_ALPHA_MAX = 16;

/**
 * A window shot cut out of a desktop (GNOME's screenshot tool) keeps a transparent margin with the
 * window's own shadow, so all four corner pixels are see-through. Opaque screenshots have none.
 */
export function hasTransparentBorder(input: string | Uint8Array): boolean {
    return cornersTransparent(typeof input === 'string' ? decodeImageFile(input) : decodeImageBytes(input));
}

function cornersTransparent(image: RasterImage): boolean {
    const right = image.width - 1;
    const bottom = image.height - 1;
    return [image.alphaAt(0, 0), image.alphaAt(right, 0), image.alphaAt(0, bottom), image.alphaAt(right, bottom)].every(
        (alpha) => alpha < CORNER_ALPHA_MAX,
    );
}

/**
 * Drops rows and columns in which not one pixel is painted at all.
 *
 * A window shot is saved on a canvas large enough for the window's shadow, and how much empty space
 * is left around that shadow is up to whoever took the shot. The page cannot see it: the slide sizes
 * the whole file, so the picture shrinks by the margin and the band above and below it stays blank.
 * Cropping to the painted area makes every screenshot fill its slide equally — and it keeps the
 * shadow itself, which is why the threshold is "nothing at all" rather than "barely visible".
 */
export function trimTransparentMargin(image: RasterImage): RasterImage {
    const bounds = image.opaqueBounds(ALPHA_EMPTY);
    if (!bounds) return image;
    if (bounds.width === image.width && bounds.height === image.height) return image;
    return image.cropped(bounds);
}

async function isFresh(cached: string, source: string): Promise<boolean> {
    if (!existsSync(cached)) return false;
    const [a, b] = await Promise.all([stat(cached), stat(source)]);
    return a.mtimeMs >= b.mtimeMs;
}

/** Encodes AVIF, WebP and PNG renditions of one screenshot into `outDir` and describes them. */
export async function processImage(source: string, slug: string, options: ImageOptions): Promise<ProcessedImage> {
    const decoded = decodeImageFile(source);
    if (!decoded.width || !decoded.height) throw new Error(`Cannot read the size of ${source}`);
    const image = trimTransparentMargin(decoded);
    const widths = renditionWidths(image.width);
    await Promise.all([mkdir(options.outDir, { recursive: true }), mkdir(options.cacheDir, { recursive: true })]);

    const formats: Record<ImageFormat, ImageFile[]> = { avif: [], webp: [], png: [] };
    for (const width of widths) {
        // Scaled at most once per width, and only when some format misses the
        // cache — the resample is the expensive half of a warm rebuild.
        let scaled: RasterImage | undefined;
        for (const format of FORMATS) {
            const name = `${slug}-${width}.${format}`;
            // The filter is part of the cache key: switching the theme must not serve stale renditions.
            const cached = join(options.cacheDir, options.pixelated ? `px-${name}` : name);
            if (!(await isFresh(cached, source))) {
                scaled ??= image.resizedToWidth(width, options.pixelated ? 'nearest' : 'smooth');
                await writeFile(cached, scaled.encode(format));
            }
            await copyFile(cached, join(options.outDir, name));
            formats[format].push({ url: `${options.urlBase}${name}`, width });
        }
    }
    for (const format of FORMATS) formats[format].sort((a, b) => a.width - b.width);

    const largest = widths[widths.length - 1] as number;
    return {
        width: largest,
        height: Math.round((largest * image.height) / image.width),
        displayWidth: displayWidth(image.width),
        formats,
        frameless: cornersTransparent(image),
    };
}
