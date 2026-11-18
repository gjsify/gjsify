import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { decodeImageFile, decodeImageFileAtSize, svgToPng } from '../render/image-backend.js';
import { languageCandidates } from '../site-data/po.js';
import { imageSlug, resolveScreenshots, screenshotFile, type ScreenshotOptions } from '../site-data/screenshots.js';
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

export interface ShotSets {
    /** The source-language set; what every language without its own set shows. */
    source: SourceShot[];
    /** Only the languages whose set differs from `source`. */
    byLanguage: Record<string, SourceShot[]>;
}

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;

async function imagesIn(dir: string): Promise<SourceShot[]> {
    const names = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && IMAGE_FILE.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    // The output numbers files itself; `01-hero.png` would otherwise become `01-01-hero.png`.
    return names.map((name) => ({ file: join(dir, name), slug: imageSlug(name.replace(/^\d+[-_](?=.)/, '')) }));
}

/**
 * The files to publish: a configured directory of PNGs (optionally with a `<lang>/` subdirectory per
 * language), else the metainfo's own screenshots (with their `xml:lang` images).
 */
export async function listingScreenshots(
    metainfo: Metainfo,
    config: ListingConfig,
    root: string,
    options: Omit<ScreenshotOptions, 'root' | 'repository'>,
): Promise<ShotSets> {
    const others = config.languages.filter((language) => language !== config.sourceLanguage);
    if (config.screenshots) {
        const dir = resolve(root, config.screenshots);
        if (!existsSync(dir))
            throw new Error(`gjsify.webext.listing.screenshots: "${config.screenshots}" does not exist`);
        const subdir = (language: string) =>
            languageCandidates(language)
                .map((candidate) => join(dir, candidate))
                .find((candidate) => existsSync(candidate));
        const byLanguage: Record<string, SourceShot[]> = {};
        for (const language of others) {
            const sub = subdir(language);
            const set = sub ? await imagesIn(sub) : [];
            if (set.length > 0) byLanguage[language] = set;
        }
        let source = await imagesIn(dir);
        const sourceSub = subdir(config.sourceLanguage);
        if (source.length === 0 && sourceSub) source = await imagesIn(sourceSub);
        return { source, byLanguage };
    }
    if (!config.repository) {
        throw new Error(
            'Screenshots from the metainfo need gjsify.webext.listing.repository (or gjsify.site.repository)',
        );
    }
    const shots = await resolveScreenshots(metainfo, { ...options, root, repository: config.repository });
    const byLanguage: Record<string, SourceShot[]> = {};
    for (const language of others) {
        const files = shots.map((shot) => screenshotFile(shot, language, 'light'));
        if (files.some((file, index) => file.file !== shots[index]?.file))
            byLanguage[language] = files.map(({ file, slug }) => ({ file, slug }));
    }
    return { source: shots.map(({ file, slug }) => ({ file, slug })), byLanguage };
}

/**
 * The dark twin of a listing screenshot: the same path below `gjsify.webext.listing.screenshotsDark`
 * as the light file has below `screenshots`. Website-only; `webext listing` never calls this.
 */
export function darkTwin(config: ListingConfig, root: string, file: string): string | undefined {
    if (!config.screenshots || !config.screenshotsDark) return undefined;
    const twin = join(resolve(root, config.screenshotsDark), relative(resolve(root, config.screenshots), file));
    return existsSync(twin) ? twin : undefined;
}

/** Whether a language needs tiles of its own: the store localizes them and the text differs from the source. */
export function hasOwnPromo(
    store: Store,
    entry: { name: string; summary: string },
    source: { name: string; summary: string },
): boolean {
    return STORE_SPECS[store].localized.promo && (entry.name !== source.name || entry.summary !== source.summary);
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
