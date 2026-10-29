import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseSiteConfig, type RootManifest } from './config.js';
import { buildDownloadTargets, recordedArtifact } from './downloads.js';
import { fetchFlathubStats, fetchFlathubSummary } from './flathub.js';
import { fetchLatestRelease, fetchReleaseRecords } from './github.js';
import { parseMetainfo } from './metainfo.js';
import type { NetworkOptions } from './network.js';
import { minimumAge } from './oars.js';
import { completeLocalized, languageCandidates, parseCatalog, type Catalog } from './po.js';
import { loadRelatedApps } from './related.js';
import { resolveScreenshots } from './screenshots.js';
import type {
    DescriptionBlock,
    LatestRelease,
    Localized,
    Metainfo,
    Release,
    SiteConfig,
    SiteData,
    Stats,
} from './types.js';

export interface LoadOptions {
    /** Repository root: where the root package.json lives and the config's paths start. */
    root: string;
    /** Where screenshots hosted outside this repository are kept, so a later offline build finds them again. */
    screenshotCacheDir?: string;
    /** Skip every network call (release assets, stats, screenshots hosted elsewhere). */
    offline?: boolean;
    githubToken?: string;
    network?: NetworkOptions;
    warn?: (message: string) => void;
}

/** Reads `<dir>/<lang>.po` for every language, trying `pt-BR` and `pt_BR` spellings; missing files are skipped. */
export async function loadCatalogs(dir: string, languages: readonly string[]): Promise<Record<string, Catalog>> {
    const catalogs: Record<string, Catalog> = {};
    for (const language of languages) {
        for (const candidate of languageCandidates(language)) {
            const file = join(dir, `${candidate}.po`);
            if (existsSync(file)) {
                catalogs[language] = parseCatalog(await readFile(file, 'utf8'));
                break;
            }
        }
    }
    return catalogs;
}

/**
 * The page's own strings are always translated; the app's text only when the metainfo or a
 * catalogue brings a translation. Say so once per language instead of silently showing English.
 */
function warnMissingTranslations(
    config: SiteConfig,
    metainfo: Metainfo,
    complete: (text: Localized) => Localized,
    warn: (message: string) => void,
): void {
    const texts = [
        metainfo.name,
        metainfo.summary,
        ...metainfo.description.flatMap((block) => (block.type === 'paragraph' ? [block.text] : block.items)),
    ];
    for (const language of config.languages) {
        if (language === config.sourceLanguage) continue;
        const missing = texts.filter((text) => complete(text).byLanguage[language] === undefined).length;
        if (missing > 0) {
            const hint = config.translations
                ? ''
                : ' (set "gjsify.site.translations" to a directory of .po catalogues)';
            warn(
                `${missing} of ${texts.length} app texts have no "${language}" translation and show the source text${hint}`,
            );
        }
    }
}

/** Collects everything the pages need into one object. Network failures degrade to warnings. */
export async function loadSiteData(options: LoadOptions): Promise<SiteData> {
    const warnings: string[] = [];
    const warn = (message: string) => {
        warnings.push(message);
        options.warn?.(message);
    };

    const manifest = JSON.parse(await readFile(join(options.root, 'package.json'), 'utf8')) as RootManifest;
    const config = parseSiteConfig(manifest);
    const version = manifest.version ?? '';

    const metainfoPath = resolve(options.root, config.metainfo);
    if (!existsSync(metainfoPath))
        throw new Error(`gjsify.site.metainfo points to "${config.metainfo}", which does not exist`);
    const metainfo = parseMetainfo(await readFile(metainfoPath, 'utf8'));

    const appCatalogs = config.translations
        ? await loadCatalogs(resolve(options.root, config.translations), config.languages)
        : {};
    const complete = (text: Localized) => completeLocalized(text, config.languages, config.sourceLanguage, appCatalogs);
    const completeBlocks = (blocks: DescriptionBlock[]): DescriptionBlock[] =>
        blocks.map((block) =>
            block.type === 'paragraph'
                ? { type: 'paragraph', text: complete(block.text) }
                : { type: 'list', items: block.items.map(complete) },
        );

    warnMissingTranslations(config, metainfo, complete, warn);

    const screenshots = (
        await resolveScreenshots(metainfo, {
            root: options.root,
            repository: config.repository,
            cacheDir: options.screenshotCacheDir,
            offline: options.offline,
            network: options.network,
            warn,
        })
    ).map((screenshot) => ({
        ...screenshot,
        caption: screenshot.caption ? complete(screenshot.caption) : null,
    }));

    const icon = config.icon ?? manifest.gjsify?.flatpak?.icon ?? manifest.gjsify?.ship?.icon;
    if (icon && !existsSync(resolve(options.root, icon))) throw new Error(`The app icon "${icon}" does not exist`);

    let latestRelease: LatestRelease | null = null;
    let hasReleases = true;
    let flathubSize: number | undefined;
    let records: Map<string, unknown> | undefined;
    const stats: Stats = {};
    if (!options.offline) {
        const network = options.network ?? {};
        const [release, flathub, summary] = await Promise.allSettled([
            fetchLatestRelease(config.repository, options.githubToken, network),
            config.flathub ? fetchFlathubStats(config.flathub, network) : Promise.resolve(undefined),
            config.flathub ? fetchFlathubSummary(config.flathub, network) : Promise.resolve(undefined),
        ]);
        if (release.status === 'fulfilled') {
            latestRelease = release.value;
            hasReleases = latestRelease !== null;
            if (latestRelease) {
                // A release record is fetched by every site build, not by a person installing.
                stats.githubDownloads = latestRelease.assets
                    .filter((asset) => recordedArtifact(asset.name) === undefined)
                    .reduce((sum, asset) => sum + asset.downloadCount, 0);
                if (config.releaseAssets) records = await fetchReleaseRecords(latestRelease.assets, network, warn);
            }
        } else {
            warn(
                `Could not fetch the latest GitHub release (${String(release.reason)}); linking to the releases page instead`,
            );
        }
        if (flathub.status === 'fulfilled' && flathub.value) {
            stats.flathubInstalls = flathub.value.installsTotal;
            stats.flathubInstallsLastMonth = flathub.value.installsLastMonth;
        } else if (flathub.status === 'rejected') {
            warn(`Could not fetch Flathub statistics (${String(flathub.reason)}); omitting install counts`);
        }
        if (summary.status === 'fulfilled') {
            flathubSize = summary.value?.downloadSize;
        } else {
            warn(`Could not fetch the Flathub summary (${String(summary.reason)}); falling back to the bundle size`);
        }
    }

    const age = metainfo.contentRating
        ? minimumAge(metainfo.contentRating.type, metainfo.contentRating.attributes)
        : undefined;
    const developer = metainfo.developer.name
        ? metainfo.developer
        : { id: manifest.gjsify?.flatpak?.developer?.id, name: manifest.gjsify?.flatpak?.developer?.name ?? '' };

    const relatedApps = await loadRelatedApps(config, metainfo.id, {
        offline: options.offline,
        network: options.network,
        warn,
    });

    const releases: Release[] = metainfo.releases.map((release) => ({
        ...release,
        description: completeBlocks(release.description),
    }));

    return {
        config,
        version,
        app: {
            id: metainfo.id,
            name: complete(metainfo.name),
            summary: complete(metainfo.summary),
            developer,
            description: completeBlocks(metainfo.description),
            license: metainfo.projectLicense,
            contentLicense: metainfo.metadataLicense,
            keywords: metainfo.keywords.map(complete),
            categories: metainfo.categories,
            urls: metainfo.urls,
            branding: metainfo.branding,
            ageRating: age === undefined ? undefined : { minAge: age },
            icon,
        },
        screenshots,
        releases,
        latestRelease,
        downloads: {
            targets: buildDownloadTargets({
                assets: config.releaseAssets ? (latestRelease?.assets ?? []) : [],
                configured: config.downloads,
                components: config.components,
                records,
                flathub: config.flathub,
                flathubSize,
                webAppUrl: config.webApp ? `${config.base}${config.webApp.replace(/^\//, '')}` : undefined,
            }),
            releasesUrl: `https://github.com/${config.repository}/releases`,
            hasReleases,
        },
        stats,
        relatedApps,
        warnings,
    };
}
