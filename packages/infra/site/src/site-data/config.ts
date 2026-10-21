import { isValidBic, isValidIban, normalizeIban } from './sepa.js';
import type {
    TargetFormat,
    TargetPlatform,
    SiteComponent,
    SiteConfig,
    SiteDownloadConfig,
    SiteLegalLink,
    SiteRelatedAppConfig,
    SiteSupportEntry,
} from './types.js';

/** The slice of the root package.json the site reads. Everything is optional until validated. */
export interface RootManifest {
    version?: string;
    gjsify?: {
        site?: unknown;
        ship?: { icon?: string };
        flatpak?: { appId?: string; icon?: string; developer?: { id?: string; name?: string } };
    };
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(raw: Raw, key: string): string {
    const value = raw[key];
    if (typeof value !== 'string' || value === '')
        throw new Error(`gjsify.site.${key} is required and must be a non-empty string`);
    return value;
}

function optionalString(raw: Raw, key: string): string | undefined {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value === '') throw new Error(`gjsify.site.${key} must be a non-empty string`);
    return value;
}

function objectList(raw: Raw, key: string): Raw[] {
    const value = raw[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every(isRecord))
        throw new Error(`gjsify.site.${key} must be a list of objects`);
    return value;
}

function stringField(entry: Raw, key: string, where: string): string {
    const value = entry[key];
    if (typeof value !== 'string' || value === '') throw new Error(`${where}.${key} must be a non-empty string`);
    return value;
}

function parseSupport(entry: Raw, where: string): SiteSupportEntry {
    const kind = stringField(entry, 'kind', where);
    if (kind !== 'sepa') return { kind, url: stringField(entry, 'url', where) };
    const optional = (key: string): string | undefined => {
        if (entry[key] === undefined) return undefined;
        return stringField(entry, key, where);
    };
    const iban = normalizeIban(stringField(entry, 'iban', where));
    if (!isValidIban(iban)) throw new Error(`${where}.iban is not a valid IBAN (format or checksum)`);
    const bic = optional('bic')?.replace(/\s+/g, '').toUpperCase();
    if (bic !== undefined && !isValidBic(bic)) throw new Error(`${where}.bic is not a valid BIC (8 or 11 characters)`);
    const name = stringField(entry, 'name', where);
    if ([...name].length > 70) throw new Error(`${where}.name is longer than the 70 characters an EPC QR code allows`);
    const reference = optional('reference');
    if (reference !== undefined && [...reference].length > 140) {
        throw new Error(`${where}.reference is longer than the 140 characters an EPC QR code allows`);
    }
    return { kind: 'sepa', name, iban, bic, reference };
}

function httpUrl(value: string, where: string): string {
    if (!/^https?:\/\//.test(value)) throw new Error(`${where} must be an http(s) address`);
    return value;
}

/** Strings are site addresses to fetch `app.json` from; objects are inline entries for apps without one. */
function parseRelatedApps(raw: Raw): SiteRelatedAppConfig[] {
    const value = raw.relatedApps;
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('gjsify.site.relatedApps must be a list');
    return value.map((entry: unknown, index): SiteRelatedAppConfig => {
        const where = `gjsify.site.relatedApps[${index}]`;
        if (typeof entry === 'string') return { url: withSlash(httpUrl(entry, where)) };
        if (!isRecord(entry)) throw new Error(`${where} must be a site address or an object`);
        const field = (key: string) => (entry[key] === undefined ? undefined : stringField(entry, key, where));
        const url = withSlash(httpUrl(stringField(entry, 'url', where), `${where}.url`));
        const name = field('name');
        if (name === undefined) {
            for (const key of ['summary', 'icon']) {
                if (entry[key] !== undefined)
                    throw new Error(`${where}.${key} needs "name": inline entries have all three`);
            }
            return { url };
        }
        const icon = field('icon');
        return { url, name, summary: field('summary'), icon: icon && httpUrl(icon, `${where}.icon`) };
    });
}

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`);

const PLATFORMS: readonly TargetPlatform[] = ['linux', 'darwin', 'win32', 'android', 'web', 'firefox', 'chromium'];
const FORMATS: readonly TargetFormat[] = [
    'flathub',
    'flatpak',
    'appimage',
    'deb',
    'rpm',
    'msi',
    'zip',
    'dmg',
    'apk',
    'web',
    'store',
    'xpi',
    'source',
];

/**
 * `gjsify.site.components`: the parts of the product a person installs one after another. `match`
 * arrives as a string because this is JSON, and is compiled case-insensitively — release asset
 * names differ in case between the formats that build them.
 */
function parseComponents(raw: Raw): SiteComponent[] {
    return objectList(raw, 'components').map((entry, index) => {
        const where = `gjsify.site.components[${index}]`;
        const id = stringField(entry, 'id', where);
        const name = stringField(entry, 'name', where);
        const summary = entry.summary === undefined ? undefined : stringField(entry, 'summary', where);
        if (entry.match === undefined) return { id, name, summary };
        const pattern = stringField(entry, 'match', where);
        try {
            return { id, name, summary, match: new RegExp(pattern, 'i') };
        } catch (cause) {
            throw new Error(`${where}.match is not a valid regular expression: ${pattern}`, { cause });
        }
    });
}

function parseDownloads(raw: Raw, components: readonly SiteComponent[]): SiteDownloadConfig[] {
    return objectList(raw, 'downloads').map((entry, index) => {
        const where = `gjsify.site.downloads[${index}]`;
        const platform = stringField(entry, 'platform', where) as TargetPlatform;
        if (!PLATFORMS.includes(platform)) throw new Error(`${where}.platform must be one of ${PLATFORMS.join(', ')}`);
        const format = stringField(entry, 'format', where) as TargetFormat;
        if (!FORMATS.includes(format)) throw new Error(`${where}.format must be one of ${FORMATS.join(', ')}`);
        const available = entry.available ?? true;
        if (typeof available !== 'boolean') throw new Error(`${where}.available must be true or false`);
        const url = entry.url;
        if (available && (typeof url !== 'string' || !/^https?:\/\//.test(url))) {
            throw new Error(`${where}.url must be an http(s) address unless "available" is false`);
        }
        if (url !== undefined && (typeof url !== 'string' || !/^https?:\/\//.test(url))) {
            throw new Error(`${where}.url must be an http(s) address`);
        }
        const label = entry.label;
        if (label !== undefined && (typeof label !== 'string' || label === ''))
            throw new Error(`${where}.label must be a non-empty string`);
        const component = entry.component === undefined ? undefined : stringField(entry, 'component', where);
        // A typo here would silently drop the row into the unnamed rest of the dialog.
        if (component !== undefined && !components.some((part) => part.id === component)) {
            throw new Error(
                `${where}.component "${component}" is not one of gjsify.site.components: ${components.map((part) => part.id).join(', ') || '(none declared)'}`,
            );
        }
        return { platform, format, url, label, available, component };
    });
}

function parseReleaseAssets(raw: Raw): boolean {
    const value = raw.releaseAssets ?? true;
    if (typeof value !== 'boolean') throw new Error('gjsify.site.releaseAssets must be true or false');
    return value;
}

/** Root-relative directory URL: `/x/` with a leading and trailing slash. */
export function normalizeBase(base: string): string {
    return `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

/** Validates `gjsify.site` and applies defaults; the error names the offending key. */
export function parseSiteConfig(manifest: RootManifest): SiteConfig {
    const raw = manifest.gjsify?.site;
    if (!isRecord(raw)) throw new Error('The root package.json has no "gjsify.site" object');

    const languages = raw.languages ?? ['en'];
    if (!Array.isArray(languages) || languages.length === 0 || !languages.every((entry) => typeof entry === 'string')) {
        throw new Error('gjsify.site.languages must be a non-empty list of language codes');
    }
    const defaultLanguage = optionalString(raw, 'defaultLanguage') ?? (languages[0] as string);
    if (!languages.includes(defaultLanguage))
        throw new Error(`gjsify.site.defaultLanguage "${defaultLanguage}" is not in languages`);

    const url = requireString(raw, 'url');
    const components = parseComponents(raw);

    return {
        metainfo: requireString(raw, 'metainfo'),
        base: normalizeBase(requireString(raw, 'base')),
        url: withSlash(url),
        languages: languages as string[],
        defaultLanguage,
        sourceLanguage: optionalString(raw, 'sourceLanguage') ?? 'en',
        repository: requireString(raw, 'repository'),
        flathub: optionalString(raw, 'flathub'),
        webApp: optionalString(raw, 'webApp'),
        translations: optionalString(raw, 'translations'),
        pageTranslations: optionalString(raw, 'pageTranslations'),
        icon: optionalString(raw, 'icon'),
        components,
        downloads: parseDownloads(raw, components),
        releaseAssets: parseReleaseAssets(raw),
        support: objectList(raw, 'support').map((entry, index) => parseSupport(entry, `gjsify.site.support[${index}]`)),
        legal: objectList(raw, 'legal').map(
            (entry, index): SiteLegalLink => ({
                label: stringField(entry, 'label', `gjsify.site.legal[${index}]`),
                url: stringField(entry, 'url', `gjsify.site.legal[${index}]`),
            }),
        ),
        relatedApps: parseRelatedApps(raw),
    };
}

/** The `kind` labels the support page knows by name; the page catalogues translate them. */
export const SUPPORT_KIND_LABELS = ['GitHub Sponsors', 'Liberapay', 'PayPal'] as const;
