import { isValidBic, isValidIban, normalizeIban } from './sepa.js';
import type {
    TargetFormat,
    TargetPlatform,
    SiteConfig,
    SiteDownloadConfig,
    SiteLegalLink,
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

function parseDownloads(raw: Raw): SiteDownloadConfig[] {
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
        return { platform, format, url, label, available };
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

    return {
        metainfo: requireString(raw, 'metainfo'),
        base: normalizeBase(requireString(raw, 'base')),
        url: url.endsWith('/') ? url : `${url}/`,
        languages: languages as string[],
        defaultLanguage,
        sourceLanguage: optionalString(raw, 'sourceLanguage') ?? 'en',
        repository: requireString(raw, 'repository'),
        flathub: optionalString(raw, 'flathub'),
        webApp: optionalString(raw, 'webApp'),
        translations: optionalString(raw, 'translations'),
        pageTranslations: optionalString(raw, 'pageTranslations'),
        icon: optionalString(raw, 'icon'),
        downloads: parseDownloads(raw),
        releaseAssets: parseReleaseAssets(raw),
        support: objectList(raw, 'support').map((entry, index) => parseSupport(entry, `gjsify.site.support[${index}]`)),
        legal: objectList(raw, 'legal').map(
            (entry, index): SiteLegalLink => ({
                label: stringField(entry, 'label', `gjsify.site.legal[${index}]`),
                url: stringField(entry, 'url', `gjsify.site.legal[${index}]`),
            }),
        ),
    };
}
