import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { decodeImageFile, decodeImageFileAtSize, svgToPng } from '../render/image-backend.js';
import { imageSlug, resolveScreenshots, type ScreenshotOptions } from '../site-data/screenshots.js';
import type { Metainfo } from '../site-data/types.js';
import { fitInto, parseHexColor, planPlacement } from './fit.js';
import type { Issue } from './build.js';
import type { ListingConfig } from './config.js';
import { STORE_SPECS, type PromoSpec, type Store } from './limits.js';
import { promoFileName, promoSvg, type PromoInput } from './promo.js';

export interface SourceShot {
    file: string;
    slug: string;
}

/** The files to publish: a configured directory of PNGs, else the metainfo's own screenshots. */
export async function listingScreenshots(
    metainfo: Metainfo,
    config: ListingConfig,
    root: string,
    options: Omit<ScreenshotOptions, 'root' | 'repository'>,
): Promise<SourceShot[]> {
    if (config.screenshots) {
        const dir = resolve(root, config.screenshots);
        if (!existsSync(dir))
            throw new Error(`gjsify.webext.listing.screenshots: "${config.screenshots}" does not exist`);
        const names = (await readdir(dir)).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).sort();
        return names.map((name) => ({ file: join(dir, name), slug: imageSlug(name) }));
    }
    if (!config.repository) {
        throw new Error(
            'Screenshots from the metainfo need gjsify.webext.listing.repository (or gjsify.site.repository)',
        );
    }
    const shots = await resolveScreenshots(metainfo, { ...options, root, repository: config.repository });
    return shots.map(({ file, slug }) => ({ file, slug }));
}

export interface RenderedImage {
    name: string;
    bytes?: Uint8Array;
}

/** The background a letterboxed shot sits on: the light brand colour, else white. */
export function letterboxColor(metainfo: Metainfo): number {
    return parseHexColor(metainfo.branding.light) ?? 0xffffff;
}

/**
 * Fits every screenshot onto the store's canvas. A shot that would need a blurry enlargement is an
 * issue rather than an image. `encode: false` validates geometry without producing bytes.
 */
export function renderScreenshots(
    store: Store,
    shots: readonly SourceShot[],
    background: number,
    encode: boolean,
): { images: RenderedImage[]; issues: Issue[] } {
    const spec = STORE_SPECS[store];
    const images: RenderedImage[] = [];
    const issues: Issue[] = [];
    const add = (field: string, message: string) =>
        issues.push({ store, language: '*', field, message: `${spec.label} ${field}: ${message}` });

    if (shots.length < spec.screenshots.min) {
        add(
            'screenshots',
            `${shots.length} found, at least ${spec.screenshots.min} required — ${spec.screenshots.url}`,
        );
    }
    const kept = shots.slice(0, spec.screenshots.max);
    if (shots.length > kept.length) {
        add('screenshots', `${shots.length} found, at most ${spec.screenshots.max} allowed — ${spec.screenshots.url}`);
    }
    for (const [index, shot] of kept.entries()) {
        const source = decodeImageFile(shot.file);
        const plan = planPlacement(source, spec.screenshots);
        if (!plan.ok) {
            add(`screenshots[${index + 1}]`, `${shot.slug}: ${plan.reason}`);
            continue;
        }
        const name = `${String(index + 1).padStart(2, '0')}-${shot.slug}.png`;
        const bytes = encode ? source.placed(spec.screenshots, plan.fit, background).encode('png') : undefined;
        images.push({ name, bytes });
    }
    return { images, issues };
}

/** The icon at the store's edge length, rendered from the SVG (or scaled from a PNG). */
export function renderIcon(store: Store, file: string): RenderedImage {
    const { size } = STORE_SPECS[store].icon;
    const image = decodeImageFileAtSize(file, size, size);
    if (image.width !== size || image.height !== size) {
        const fit = fitInto(image, { width: size, height: size });
        return {
            name: `icon-${size}.png`,
            bytes: image.placed({ width: size, height: size }, fit, 0xffffff).encode('png'),
        };
    }
    return { name: `icon-${size}.png`, bytes: image.encode('png') };
}

/** A promo tile drawn as SVG and rasterised by the same backend as the icon. */
export function renderPromo(spec: PromoSpec, input: PromoInput): RenderedImage {
    return { name: promoFileName(spec), bytes: svgToPng(promoSvg(spec, input)) };
}
