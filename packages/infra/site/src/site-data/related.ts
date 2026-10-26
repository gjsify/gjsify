import { fetchJson, type NetworkOptions } from './network.js';
import { pickByLanguage } from './po.js';
import type { AppManifest, RelatedApp, SiteConfig, SiteData, SiteRelatedAppConfig } from './types.js';

/** Where a site publishes its `app.json`. */
export const APP_MANIFEST_FILE = 'app.json';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const urlKey = (url: string) => url.replace(/\/+$/, '').toLowerCase();
const sameUrl = (a: string, b: string) => urlKey(a) === urlKey(b);

const HTTP_URL = /^https?:\/\//;

/** The `app.json` of a site: what another site needs to list this app. Icon URL is absolute. */
export function buildAppManifest(data: SiteData, icon: string | undefined): AppManifest {
    const texts = (text: SiteData['app']['name']): Record<string, string> => ({
        [data.config.sourceLanguage]: text.source,
        ...text.byLanguage,
    });
    return {
        schema: 1,
        id: data.app.id,
        name: texts(data.app.name),
        summary: texts(data.app.summary),
        icon,
        url: data.config.url,
        languages: [...data.config.languages],
        developer: { id: data.app.developer.id, name: data.app.developer.name },
    };
}

function stringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined;
    const entries = Object.entries(value);
    if (!entries.every(([, text]) => typeof text === 'string')) return undefined;
    return Object.fromEntries(entries) as Record<string, string>;
}

/** Validates what came off the wire; returns why not when it is unusable. */
export function parseAppManifest(raw: unknown): RelatedApp | string {
    if (!isRecord(raw)) return 'not a JSON object';
    if (raw.schema !== 1) return `unknown schema ${JSON.stringify(raw.schema)}`;
    const name = stringRecord(raw.name);
    if (!name || Object.keys(name).length === 0) return 'no "name"';
    const summary = stringRecord(raw.summary) ?? {};
    if (typeof raw.url !== 'string' || !HTTP_URL.test(raw.url)) return 'no http(s) "url"';
    const languages = Array.isArray(raw.languages) ? raw.languages.filter((l) => typeof l === 'string') : [];
    const icon = typeof raw.icon === 'string' && HTTP_URL.test(raw.icon) ? raw.icon : undefined;
    return {
        id: typeof raw.id === 'string' ? raw.id : undefined,
        name,
        summary,
        icon,
        url: raw.url.endsWith('/') ? raw.url : `${raw.url}/`,
        languages,
    };
}

export interface RelatedAppsOptions {
    /** Never touch the network; only a copy from an earlier build can answer. */
    offline?: boolean;
    network?: NetworkOptions;
    warn: (message: string) => void;
}

const offlineFetch: NonNullable<NetworkOptions['fetch']> = () => Promise.reject(new Error('offline build'));

async function loadOne(entry: SiteRelatedAppConfig, options: RelatedAppsOptions): Promise<RelatedApp | undefined> {
    if (entry.name !== undefined) {
        return {
            name: { en: entry.name },
            summary: entry.summary === undefined ? {} : { en: entry.summary },
            icon: entry.icon,
            url: entry.url,
            languages: [],
        };
    }
    const file = `${entry.url}${APP_MANIFEST_FILE}`;
    try {
        // A TTL of zero: always ask first, and let the cache answer only when the site does not.
        const raw = await fetchJson(
            file,
            { accept: 'application/json' },
            { ...options.network, cacheTtlMs: 0, fetch: options.offline ? offlineFetch : options.network?.fetch },
        );
        const parsed = parseAppManifest(raw);
        if (typeof parsed === 'string') {
            options.warn(`Related app ${file}: ${parsed}; skipping it`);
            return undefined;
        }
        return parsed;
    } catch (error) {
        options.warn(`Related app ${file} is unavailable (${String(error)}) and no earlier copy exists; skipping it`);
        return undefined;
    }
}

/** Resolves app entries in order — `relatedApps`, or a developer's `apps`. Never throws: an entry that cannot be had is skipped with a warning. */
export async function loadAppEntries(
    entries: readonly SiteRelatedAppConfig[],
    options: RelatedAppsOptions,
): Promise<RelatedApp[]> {
    const loaded = await Promise.all(entries.map((entry) => loadOne(entry, options)));
    return loaded.filter((app): app is RelatedApp => app !== undefined);
}

/**
 * Resolves `gjsify.site.relatedApps` in configured order. The site's own entry is dropped, so every
 * app can share one list.
 */
export async function loadRelatedApps(
    config: SiteConfig,
    ownId: string,
    options: RelatedAppsOptions,
): Promise<RelatedApp[]> {
    const candidates = config.relatedApps.filter((entry) => !sameUrl(entry.url, config.url));
    const loaded = await loadAppEntries(candidates, options);
    return loaded.filter((app) => app.id !== ownId && !sameUrl(app.url, config.url));
}

/** A text in the reader's language, else English, else whatever the app has. */
export function relatedText(text: Record<string, string>, lang: string): string {
    return pickByLanguage(text, lang) ?? text.en ?? Object.values(text)[0] ?? '';
}

/** The page of a related app in the reader's language, or its start page when it has no such one. */
export function relatedUrl(app: RelatedApp, lang: string): string {
    if (app.languages.length === 0) return app.url;
    return `${app.url}${app.languages.includes(lang) ? lang : app.languages[0]}/`;
}
