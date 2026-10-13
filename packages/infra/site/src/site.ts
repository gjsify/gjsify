// The two things a consumer asks of this package: render the pages of a repository, and keep the
// page catalogues in sync with the strings the renderer can emit. `cli.ts` is argv parsing on top.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogMsgids, configMsgids, rendererMsgids, syncCatalogs, type I18nResult } from './build/i18n.js';
import { processImage, type ProcessedImage } from './build/images.js';
import { pictureVariants, renderPage, renderRoot, type ClientAssets } from './build/pages.js';
import {
    UI_SOURCE_LANGUAGE,
    loadCatalogs,
    loadSiteData,
    mergeCatalogs,
    parseSiteConfig,
    translator,
    type Catalog,
    type RootManifest,
    type SiteConfig,
    type SiteData,
} from './site-data/index.js';

/**
 * This package's own directory: `lib/` holds the client bundle, `po/` the page catalogues.
 *
 * Both `src/site.ts` and the emitted `lib/site.js` sit one level below it, so the module's own URL
 * answers this — except from a bundle, where the inlined module reports the outfile's location. A
 * caller that knows better passes `packageDir`.
 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const poDir = (dir = packageDir) => join(dir, 'po');
const clientDir = (dir = packageDir) => join(dir, 'lib/client');
/** Where the renderer's translator calls are read from when this package's own catalogue is synced. */
const rendererDir = (dir = packageDir) => join(dir, 'src/build');
/** `options.packageDir` when given, else the install this module was loaded from. */
const selfDir = (given?: string) => (given === undefined ? packageDir : resolve(given));

/** Where a build reads from and writes to. */
export interface SiteTarget {
    /** Repository root: the root package.json, the metainfo, the screenshots and the icon are read from here. */
    root: string;
    /** Output directory, emptied first. */
    out: string;
}

export interface SiteBuildOptions extends SiteTarget {
    /** Skip every network call; the page is rendered from what is in the repository. */
    offline?: boolean;
    /**
     * Where the one-hour HTTP response cache and the image renditions live; `false` disables the
     * response cache. A published package must not write inside its own install, so the default is
     * the consumer project's own build cache.
     */
    cacheDir?: string | false;
    /** Raises the GitHub API rate limit. Optional — the public limit is enough for a single build. */
    githubToken?: string;
    log?: (message: string) => void;
    warn?: (message: string) => void;
    /** This package's install, for a caller whose module URL does not reveal it — a bundle. */
    packageDir?: string;
}

export interface SiteBuildResult {
    /** The languages that were rendered, in configuration order. */
    languages: string[];
    /** Screenshot source paths that were turned into renditions. */
    screenshots: number;
}

export function defaultCacheDir(root: string): string {
    return join(root, 'node_modules/.cache/gjsify-site');
}

async function readConfig(root: string): Promise<SiteConfig> {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as RootManifest;
    return parseSiteConfig(manifest);
}

/** Short, stable and enough to bust a cache: the first bytes of the content's SHA-256. */
function contentHash(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

/**
 * Stages the client bundle and the stylesheet this package ships, under content-addressed names.
 * Both are built once, when the package is built — a site build neither needs a bundler nor an
 * opinion about one.
 */
async function stageClientAssets(base: string, out: string, self: string): Promise<ClientAssets> {
    const assetDir = join(out, 'assets');
    await mkdir(assetDir, { recursive: true });
    const staged = await Promise.all(
        (['js', 'css'] as const).map(async (extension) => {
            const content = await readFile(join(clientDir(self), `site.${extension}`));
            const name = `site-${contentHash(content)}.${extension}`;
            await writeFile(join(assetDir, name), content);
            return `${base}assets/${name}`;
        }),
    );
    return { js: staged[0]!, css: [staged[1]!] };
}

async function processScreenshots(
    data: SiteData,
    { root, out }: SiteTarget,
    cacheDir: string,
): Promise<Map<string, ProcessedImage>> {
    const paths = new Set(
        data.screenshots.flatMap((screenshot) => pictureVariants(screenshot).map((variant) => variant.path)),
    );
    const options = {
        outDir: join(out, 'img'),
        cacheDir: join(cacheDir, 'images'),
        urlBase: `${data.config.base}img/`,
    };
    const entries = await Promise.all(
        [...paths].map(async (path) => [path, await processImage(resolve(root, path), path, options)] as const),
    );
    return new Map(entries);
}

async function publishIcon(data: SiteData, { root, out }: SiteTarget): Promise<string | undefined> {
    if (!data.app.icon) return undefined;
    const name = basename(data.app.icon);
    await copyFile(resolve(root, data.app.icon), join(out, name));
    return `${data.config.base}${name}`;
}

/**
 * The page catalogues: the ones this package ships, overlaid with the consumer's own. A consumer
 * writes its captions and download labels itself, so only it can translate them.
 */
async function loadPageCatalogs(
    config: SiteConfig,
    root: string,
    self: string,
    warn?: (message: string) => void,
): Promise<Record<string, Catalog>> {
    const base = await loadCatalogs(poDir(self), config.languages);
    const catalogs = config.pageTranslations
        ? mergeCatalogs(base, await loadCatalogs(resolve(root, config.pageTranslations), config.languages))
        : base;
    if (warn) {
        const own = configMsgids(config);
        for (const language of config.languages) {
            if (language === UI_SOURCE_LANGUAGE) continue;
            const missing = own.filter((msgid) => !catalogs[language]?.get(msgid));
            if (missing.length === 0) continue;
            warn(
                `${language}: ${missing.length} string(s) from gjsify.site are untranslated, e.g. "${missing[0]}". ` +
                    'Run "gjsify site i18n" to write them to gjsify.site.pageTranslations.',
            );
        }
    }
    return catalogs;
}

/** Renders one static page per configured language, plus the language-picking root page. */
export async function buildSite(options: SiteBuildOptions): Promise<SiteBuildResult> {
    const target: SiteTarget = { root: resolve(options.root), out: resolve(options.out) };
    const cacheDir = options.cacheDir === false ? undefined : (options.cacheDir ?? defaultCacheDir(target.root));
    const self = selfDir(options.packageDir);
    const config = await readConfig(target.root);

    await rm(target.out, { recursive: true, force: true });
    await mkdir(target.out, { recursive: true });
    const assets = await stageClientAssets(config.base, target.out, self);

    const catalogs = await loadPageCatalogs(config, target.root, self, options.warn);
    const data = await loadSiteData({
        root: target.root,
        uiCatalogs: catalogs,
        offline: options.offline ?? false,
        githubToken: options.githubToken,
        network: cacheDir ? { cacheDir: join(cacheDir, 'http') } : {},
        warn: options.warn,
    });

    const images = await processScreenshots(data, target, cacheDir ?? defaultCacheDir(target.root));
    const iconUrl = await publishIcon(data, target);

    for (const lang of data.config.languages) {
        const html = renderPage({ data, lang, t: translator(catalogs[lang]), assets, images, iconUrl });
        await mkdir(join(target.out, lang), { recursive: true });
        await writeFile(join(target.out, lang, 'index.html'), html);
    }
    await writeFile(join(target.out, 'index.html'), renderRoot(data, assets, iconUrl));
    return { languages: [...data.config.languages], screenshots: images.size };
}

export interface SiteI18nOptions {
    /**
     * The repository whose `gjsify.site` strings are synced into its `pageTranslations`. Omitted,
     * this package's own `po/` is synced from the renderer sources instead.
     */
    root?: string;
    /** Report what a regeneration would change instead of writing it. */
    check?: boolean;
    /** This package's install, for a caller whose module URL does not reveal it — a bundle. */
    packageDir?: string;
}

/** The languages this package keeps a catalogue for: whichever `po/<lang>.po` files exist. */
async function packageLanguages(dir: string): Promise<string[]> {
    const files = await readdir(dir);
    return files.filter((file) => file.endsWith('.po')).map((file) => basename(file, '.po'));
}

/**
 * Keeps gettext catalogues in sync with the strings that can actually be emitted — this package's
 * own `po/` when called without a root, otherwise the consumer's `pageTranslations`.
 */
export async function syncSiteI18n(options: SiteI18nOptions = {}): Promise<I18nResult> {
    const check = options.check ?? false;
    const self = selfDir(options.packageDir);
    if (options.root === undefined) {
        const renderers = rendererDir(self);
        if (!existsSync(renderers)) {
            throw new Error(`${renderers} does not exist: the package catalogue is synced from a source checkout`);
        }
        return syncCatalogs({
            dir: poDir(self),
            languages: await packageLanguages(poDir(self)),
            msgids: await rendererMsgids(renderers),
            check,
            pot: true,
            base: self,
        });
    }

    const root = resolve(options.root);
    const config = await readConfig(root);
    const shipped = await catalogMsgids(join(poDir(self), 'site.pot'));
    const msgids = configMsgids(config).filter((msgid) => !shipped.has(msgid));
    if (msgids.length === 0) return { stale: [], untranslated: [] };
    if (!config.pageTranslations) {
        throw new Error(
            `gjsify.site introduces ${msgids.length} string(s) of its own, e.g. "${msgids[0]}". ` +
                'Set gjsify.site.pageTranslations to the directory their catalogues should live in.',
        );
    }

    const dir = resolve(root, config.pageTranslations);
    if (!check) await mkdir(dir, { recursive: true });
    return syncCatalogs({ dir, languages: config.languages, msgids, check, base: root });
}
