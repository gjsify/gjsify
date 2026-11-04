import { isAbsolute } from 'node:path';

import type { Store } from './limits.js';

/** The slice of the root package.json the listing reads; `gjsify.site` only supplies fallbacks. */
export interface ListingManifest {
    gjsify?: {
        webext?: { listing?: unknown };
        site?: unknown;
        ship?: { icon?: string };
        flatpak?: { icon?: string };
    };
}

export interface ListingConfig {
    /** Repo-relative path of the AppStream metainfo. */
    metainfo: string;
    languages: string[];
    sourceLanguage: string;
    /** Directory of `<lang>.po` catalogues holding the translations of the metainfo and of this block's strings. */
    translations?: string;
    repository?: string;
    /** Repo-relative icon (SVG or PNG). */
    icon?: string;
    /** Directory of PNGs used instead of the metainfo screenshots. */
    screenshots?: string;
    /** msgid: the single purpose, in one sentence. */
    singlePurpose?: string;
    /** permission or host pattern → msgid of its justification. */
    permissions: Record<string, string>;
    category: Partial<Record<Store, string>>;
    privacyUrl?: string;
    /** Used when the metainfo has no privacy URL and no `privacyUrl` is set: `<siteUrl><lang>/privacy/`. */
    siteUrl?: string;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

function str(raw: Raw, key: string, where: string): string | undefined {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value === '') throw new Error(`${where}.${key} must be a non-empty string`);
    return value;
}

/**
 * Merges `gjsify.webext.listing` (and `override`, e.g. a `--config` file, which wins) over the
 * `gjsify.site` values that mean the same thing. Errors name the offending key.
 */
export function parseListingConfig(manifest: ListingManifest, override: unknown = undefined): ListingConfig {
    const own = manifest.gjsify?.webext?.listing;
    if (own !== undefined && !isRecord(own)) throw new Error('gjsify.webext.listing must be an object');
    if (override !== undefined && !isRecord(override)) throw new Error('The listing config must be a JSON object');
    const raw: Raw = { ...own, ...override };
    const where = 'gjsify.webext.listing';
    const site = isRecord(manifest.gjsify?.site) ? (manifest.gjsify?.site as Raw) : {};

    const metainfo = str(raw, 'metainfo', where) ?? (typeof site.metainfo === 'string' ? site.metainfo : undefined);
    if (!metainfo) throw new Error(`${where}.metainfo is required (or set gjsify.site.metainfo, or pass --metainfo)`);

    const languages = raw.languages ?? site.languages ?? ['en'];
    if (!Array.isArray(languages) || languages.length === 0 || !languages.every((entry) => typeof entry === 'string')) {
        throw new Error(`${where}.languages must be a non-empty list of language codes`);
    }

    const permissions: Record<string, string> = {};
    if (raw.permissions !== undefined) {
        if (!isRecord(raw.permissions))
            throw new Error(`${where}.permissions must map a permission to its justification`);
        for (const [permission, text] of Object.entries(raw.permissions)) {
            if (typeof text !== 'string' || text === '')
                throw new Error(`${where}.permissions["${permission}"] must be a non-empty string`);
            permissions[permission] = text;
        }
    }

    const category: Partial<Record<Store, string>> = {};
    if (raw.category !== undefined) {
        if (!isRecord(raw.category))
            throw new Error(`${where}.category must map a store (cws, edge, amo) to a category`);
        for (const [store, value] of Object.entries(raw.category)) {
            if (store !== 'cws' && store !== 'edge' && store !== 'amo')
                throw new Error(`${where}.category.${store}: unknown store (use cws, edge or amo)`);
            if (typeof value !== 'string' || value === '')
                throw new Error(`${where}.category.${store} must be a string`);
            category[store] = value;
        }
    }

    const icon =
        str(raw, 'icon', where) ??
        (typeof site.icon === 'string' ? site.icon : (manifest.gjsify?.ship?.icon ?? manifest.gjsify?.flatpak?.icon));
    const translations =
        str(raw, 'translations', where) ?? (typeof site.translations === 'string' ? site.translations : undefined);
    const screenshots = str(raw, 'screenshots', where);
    for (const [key, value] of [
        ['screenshots', screenshots],
        ['translations', translations],
        ['icon', icon],
    ] as const) {
        if (value !== undefined && isAbsolute(value)) throw new Error(`${where}.${key} must be repo-relative`);
    }

    return {
        metainfo,
        languages: languages as string[],
        sourceLanguage:
            str(raw, 'sourceLanguage', where) ?? (typeof site.sourceLanguage === 'string' ? site.sourceLanguage : 'en'),
        translations,
        repository:
            str(raw, 'repository', where) ?? (typeof site.repository === 'string' ? site.repository : undefined),
        icon,
        screenshots,
        singlePurpose: str(raw, 'singlePurpose', where),
        permissions,
        category,
        privacyUrl: str(raw, 'privacyUrl', where),
        siteUrl: site.privacy !== undefined && typeof site.url === 'string' ? site.url.replace(/\/?$/, '/') : undefined,
    };
}
