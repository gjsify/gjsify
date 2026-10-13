import { existsSync } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { decodeImageBytes, decodeImageFile, type ImageFormat, type RasterImage } from "./image-backend.js";

export type { ImageFormat };

export interface ImageFile {
  url: string;
  width: number;
}

export interface ProcessedImage {
  /** Intrinsic size of the largest rendition, for the `width`/`height` attributes. */
  width: number;
  height: number;
  formats: Record<ImageFormat, ImageFile[]>;
  /** The artwork already carries its own transparent margin and shadow (a window shot), so the page adds no frame. */
  frameless: boolean;
}

export interface ImageOptions {
  /** Directory the renditions are published into (served below `urlBase`). */
  outDir: string;
  /** Persistent store of encoded renditions; AVIF is slow, so it is reused while the source is unchanged. */
  cacheDir: string;
  urlBase: string;
}

const TARGET_WIDTHS = [480, 960, 1440];
const FORMATS: ImageFormat[] = ["avif", "webp", "png"];

export function imageSlug(path: string): string {
  return path
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Never upscales: widths above the source are dropped, and the source's own width is used if it is the largest that fits. */
export function renditionWidths(natural: number): number[] {
  const widths = new Set(TARGET_WIDTHS.filter((width) => width < natural));
  widths.add(Math.min(natural, TARGET_WIDTHS[TARGET_WIDTHS.length - 1] as number));
  return [...widths].sort((a, b) => a - b);
}

const CORNER_ALPHA_MAX = 16;

/**
 * A window shot cut out of a desktop (GNOME's screenshot tool) keeps a transparent margin with the
 * window's own shadow, so all four corner pixels are see-through. Opaque screenshots have none.
 */
export function hasTransparentBorder(input: string | Uint8Array): boolean {
  return cornersTransparent(typeof input === "string" ? decodeImageFile(input) : decodeImageBytes(input));
}

function cornersTransparent(image: RasterImage): boolean {
  const right = image.width - 1;
  const bottom = image.height - 1;
  return [
    image.alphaAt(0, 0),
    image.alphaAt(right, 0),
    image.alphaAt(0, bottom),
    image.alphaAt(right, bottom),
  ].every((alpha) => alpha < CORNER_ALPHA_MAX);
}

async function isFresh(cached: string, source: string): Promise<boolean> {
  if (!existsSync(cached)) return false;
  const [a, b] = await Promise.all([stat(cached), stat(source)]);
  return a.mtimeMs >= b.mtimeMs;
}

/** Encodes AVIF, WebP and PNG renditions of one screenshot into `outDir` and describes them. */
export async function processImage(source: string, repoPath: string, options: ImageOptions): Promise<ProcessedImage> {
  const image = decodeImageFile(source);
  if (!image.width || !image.height) throw new Error(`Cannot read the size of ${repoPath}`);
  const widths = renditionWidths(image.width);
  const slug = imageSlug(repoPath);
  await Promise.all([mkdir(options.outDir, { recursive: true }), mkdir(options.cacheDir, { recursive: true })]);

  const formats: Record<ImageFormat, ImageFile[]> = { avif: [], webp: [], png: [] };
  for (const width of widths) {
    // Scaled at most once per width, and only when some format misses the
    // cache — the resample is the expensive half of a warm rebuild.
    let scaled: RasterImage | undefined;
    for (const format of FORMATS) {
      const name = `${slug}-${width}.${format}`;
      const cached = join(options.cacheDir, name);
      if (!(await isFresh(cached, source))) {
        scaled ??= image.resizedToWidth(width);
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
    formats,
    frameless: cornersTransparent(image),
  };
}
