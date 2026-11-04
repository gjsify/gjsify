import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { renderPo } from '../render/i18n.js';
import { parseMetainfo } from '../site-data/metainfo.js';
import { loadCatalogs } from '../site-data/load.js';
import { buildListingModel, type Issue, type ListingModel, type StoreEntry } from './build.js';
import { parseListingConfig, type ListingConfig } from './config.js';
import { letterboxColor, listingScreenshots, renderIcon, renderScreenshots, type RenderedImage } from './images.js';
import { STORE_SPECS, STORES, type Store } from './limits.js';

export interface ListingOptions {
    root: string;
    out: string;
    stores?: readonly Store[];
    /** Validate only; nothing is written. */
    check?: boolean;
    /** Override of the `gjsify.webext.listing` block (a `--config` file). */
    config?: unknown;
    /** Overrides `metainfo` of the config. */
    metainfo?: string;
    /** Write the config strings as a `.pot` template here. */
    pot?: string;
    offline?: boolean;
    cacheDir?: string;
    warn?: (message: string) => void;
}

export interface ListingResult {
    issues: Issue[];
    warnings: string[];
    files: string[];
}

export function permissionsMarkdown(entry: StoreEntry): string {
    const rows = entry.permissions.map(
        ({ permission, justification }) => `| \`${permission}\` | ${justification.replace(/\|/g, '\\|')} |`,
    );
    return [
        '# Privacy practices',
        '',
        '## Single purpose',
        '',
        entry.singlePurpose || '_not set_',
        '',
        '## Permission justifications',
        '',
        ...(rows.length > 0
            ? ['| Permission | Justification |', '| --- | --- |', ...rows]
            : ['_No permissions declared._']),
        '',
        ...(entry.privacyUrl ? ['## Privacy policy', '', entry.privacyUrl, ''] : []),
    ].join('\n');
}

const ensureNewline = (text: string) => (text.endsWith('\n') ? text : `${text}\n`);

export async function runListing(options: ListingOptions): Promise<ListingResult> {
    const warn = options.warn ?? (() => {});
    const root = resolve(options.root);
    const manifestFile = join(root, 'package.json');
    if (!existsSync(manifestFile)) throw new Error(`No package.json in ${root}`);
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const config: ListingConfig = parseListingConfig(manifest, {
        ...(options.config as object | undefined),
        ...(options.metainfo ? { metainfo: options.metainfo } : {}),
    });
    const metainfo = parseMetainfo(await readFile(resolve(root, config.metainfo), 'utf8'));
    const catalogs = config.translations
        ? await loadCatalogs(resolve(root, config.translations), config.languages)
        : {};
    const stores = options.stores ?? STORES;

    const model: ListingModel = buildListingModel({ metainfo, config, catalogs, stores });
    const issues = [...model.issues];
    const warnings = [...model.warnings];
    if (!config.translations && config.languages.some((language) => language !== config.sourceLanguage)) {
        warnings.push('No translations directory: set gjsify.webext.listing.translations (a directory of .po files)');
    }

    const shots = await listingScreenshots(metainfo, config, root, {
        cacheDir: options.cacheDir,
        offline: options.offline,
        warn: (message) => warnings.push(message),
    });
    const background = letterboxColor(metainfo);
    const iconFile = config.icon ? resolve(root, config.icon) : undefined;
    if (!iconFile || !existsSync(iconFile))
        warnings.push('No icon: set gjsify.webext.listing.icon (or gjsify.site.icon)');

    const out = resolve(options.out);
    const write = !options.check;
    const files: string[] = [];
    const emit = async (path: string, data: string | Uint8Array) => {
        if (!write) return;
        const target = join(out, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data);
        files.push(path);
    };
    if (write) await rm(out, { recursive: true, force: true });

    const index: Record<string, unknown> = {};
    for (const store of stores) {
        const entries = model.stores[store] ?? {};
        const shotResult = renderScreenshots(store, shots, background, write);
        issues.push(...shotResult.issues);
        for (const [language, entry] of Object.entries(entries)) {
            const dir = `${store}/${language}`;
            await emit(`${dir}/name.txt`, ensureNewline(entry.name));
            await emit(`${dir}/summary.txt`, ensureNewline(entry.summary));
            await emit(`${dir}/description.txt`, ensureNewline(entry.description));
            if (entry.descriptionHtml !== undefined)
                await emit(`${dir}/description.html`, ensureNewline(entry.descriptionHtml));
            if (STORE_SPECS[store].justifiesPermissions)
                await emit(`${dir}/permissions.md`, permissionsMarkdown(entry));
        }
        const icon: RenderedImage | undefined =
            iconFile && existsSync(iconFile) ? renderIcon(store, iconFile) : undefined;
        if (icon?.bytes) await emit(`${store}/${icon.name}`, icon.bytes);
        for (const image of shotResult.images)
            if (image.bytes) await emit(`${store}/screenshots/${image.name}`, image.bytes);
        index[store] = {
            languages: entries,
            screenshots: shotResult.images.map((image) => `screenshots/${image.name}`),
            icon: icon?.name,
        };
    }
    await emit('listing.json', `${JSON.stringify({ version: 1, app: metainfo.id, stores: index }, null, 2)}\n`);

    if (options.pot) {
        await writeFile(resolve(options.pot), renderPo(model.msgids, undefined));
        files.push(options.pot);
    }
    for (const message of warnings) warn(message);
    return { issues, warnings, files };
}
