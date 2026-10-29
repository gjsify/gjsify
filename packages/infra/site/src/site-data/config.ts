import { isValidBic, isValidIban, normalizeIban } from './sepa.js';
import type {
    AnySiteConfig,
    TargetFormat,
    TargetPlatform,
    SiteBlogConfig,
    SiteColor,
    SiteCommonConfig,
    SiteComponent,
    SiteConfig,
    SiteDeveloperConfig,
    SiteThemeConfig,
    SiteDownloadConfig,
    SiteLegalLink,
    SiteLegalNoticeConfig,
    SitePrivacyConfig,
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
function parseRelatedApps(value: unknown, key: string): SiteRelatedAppConfig[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${key} must be a list`);
    return value.map((entry: unknown, index): SiteRelatedAppConfig => {
        const where = `${key}[${index}]`;
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

/**
 * `gjsify.site.privacy`: every configured language needs its own statement file. A language with
 * no entry fails the build rather than falling back silently — a legal page missing a translation
 * it promised is worse than no page at all.
 */
function parsePrivacy(raw: Raw, languages: readonly string[]): SitePrivacyConfig | undefined {
    const value = raw.privacy;
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new Error('gjsify.site.privacy must be an object');
    const statementsRaw = value.statements;
    if (!isRecord(statementsRaw)) {
        throw new Error('gjsify.site.privacy.statements must be an object mapping a language to a file path');
    }
    const statements: Record<string, string> = {};
    for (const lang of languages) {
        statements[lang] = stringField(statementsRaw, lang, 'gjsify.site.privacy.statements');
    }
    return { statements, hostingPolicyUrl: optionalString(value, 'hostingPolicyUrl') };
}

/**
 * `gjsify.site.legalNotice`: same per-language requirement as `privacy` — a language with no entry
 * fails the build. The content is usually identical across a publisher's apps, but that is a fact
 * about what the consumer WRITES, not something this parser assumes or enforces.
 */
function parseLegalNotice(raw: Raw, languages: readonly string[]): SiteLegalNoticeConfig | undefined {
    const value = raw.legalNotice;
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new Error('gjsify.site.legalNotice must be an object');
    const statementsRaw = value.statements;
    if (!isRecord(statementsRaw)) {
        throw new Error('gjsify.site.legalNotice.statements must be an object mapping a language to a file path');
    }
    const statements: Record<string, string> = {};
    for (const lang of languages) {
        statements[lang] = stringField(statementsRaw, lang, 'gjsify.site.legalNotice.statements');
    }
    return { statements };
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

function parseBlog(raw: Raw): SiteBlogConfig | undefined {
    const value = raw.blog;
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new Error('gjsify.site.blog must be an object');
    return { posts: stringField(value, 'posts', 'gjsify.site.blog') };
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseColor(value: unknown, where: string): SiteColor {
    const hex = (entry: unknown, key: string): string => {
        if (typeof entry !== 'string' || !HEX_COLOR.test(entry))
            throw new Error(`${key} must be a hex colour like #3584e4`);
        return entry;
    };
    if (typeof value === 'string') return { light: hex(value, where), dark: value };
    if (!isRecord(value)) throw new Error(`${where} must be a hex colour or { "light", "dark" }`);
    return { light: hex(value.light, `${where}.light`), dark: hex(value.dark, `${where}.dark`) };
}

function parseTheme(raw: Raw): SiteThemeConfig {
    const value = raw.theme;
    if (value === undefined) return { imageRendering: 'auto' };
    if (!isRecord(value)) throw new Error('gjsify.site.theme must be an object');
    const imageRendering = value.imageRendering ?? 'auto';
    if (imageRendering !== 'auto' && imageRendering !== 'pixelated') {
        throw new Error('gjsify.site.theme.imageRendering must be "auto" or "pixelated"');
    }
    const displayFont =
        value.displayFont === undefined ? undefined : stringField(value, 'displayFont', 'gjsify.site.theme');
    if (displayFont !== undefined && !displayFont.endsWith('.woff2'))
        throw new Error('gjsify.site.theme.displayFont must be a .woff2 file');
    return {
        accent: value.accent === undefined ? undefined : parseColor(value.accent, 'gjsify.site.theme.accent'),
        displayFont,
        imageRendering,
    };
}

/** One file per configured language, so no page of the CV silently falls back to another language. */
function parseDeveloper(value: unknown, languages: readonly string[]): SiteDeveloperConfig {
    if (!isRecord(value)) throw new Error('gjsify.site.developer must be an object');
    const resume = value.resume;
    if (!isRecord(resume)) {
        throw new Error('gjsify.site.developer.resume must be an object mapping a language to a JSON Resume file');
    }
    return {
        resume: Object.fromEntries(
            languages.map((lang) => [lang, stringField(resume, lang, 'gjsify.site.developer.resume')]),
        ),
        apps: parseRelatedApps(value.apps, 'gjsify.site.developer.apps'),
    };
}

function parseCommon(raw: Raw, base: string | undefined): SiteCommonConfig {
    const languages = raw.languages ?? ['en'];
    if (!Array.isArray(languages) || languages.length === 0 || !languages.every((entry) => typeof entry === 'string')) {
        throw new Error('gjsify.site.languages must be a non-empty list of language codes');
    }
    const defaultLanguage = optionalString(raw, 'defaultLanguage') ?? (languages[0] as string);
    if (!languages.includes(defaultLanguage))
        throw new Error(`gjsify.site.defaultLanguage "${defaultLanguage}" is not in languages`);

    const url = withSlash(requireString(raw, 'url'));
    return {
        base: normalizeBase(base ?? requireString(raw, 'base')),
        url,
        languages: languages as string[],
        defaultLanguage,
        sourceLanguage: optionalString(raw, 'sourceLanguage') ?? 'en',
        pageTranslations: optionalString(raw, 'pageTranslations'),
        support: objectList(raw, 'support').map((entry, index) => parseSupport(entry, `gjsify.site.support[${index}]`)),
        privacy: parsePrivacy(raw, languages as string[]),
        legalNotice: parseLegalNotice(raw, languages as string[]),
        legal: objectList(raw, 'legal').map(
            (entry, index): SiteLegalLink => ({
                label: stringField(entry, 'label', `gjsify.site.legal[${index}]`),
                url: stringField(entry, 'url', `gjsify.site.legal[${index}]`),
            }),
        ),
        blog: parseBlog(raw),
        theme: parseTheme(raw),
    };
}

function siteBlock(manifest: RootManifest): Raw {
    const raw = manifest.gjsify?.site;
    if (!isRecord(raw)) throw new Error('The root package.json has no "gjsify.site" object');
    return raw;
}

/**
 * Validates `gjsify.site` of either kind and applies defaults; the error names the offending key.
 * The kind is the presence of `metainfo` (an app) or `developer` (a person) — exactly one of them.
 */
export function parseAnySiteConfig(manifest: RootManifest): AnySiteConfig {
    const raw = siteBlock(manifest);
    const isApp = raw.metainfo !== undefined;
    const isDeveloper = raw.developer !== undefined;
    if (isApp && isDeveloper) {
        throw new Error('gjsify.site has both "metainfo" and "developer"; a site is about one app or one person');
    }
    if (!isApp && !isDeveloper) {
        throw new Error('gjsify.site needs "metainfo" (an app site) or "developer" (a developer site)');
    }
    if (isApp) return parseSiteConfig(manifest);
    // The developer site usually owns the host root, so `base` may be left out there.
    const common = parseCommon(raw, optionalString(raw, 'base') ?? '/');
    if (raw.relatedApps !== undefined) {
        throw new Error('gjsify.site.relatedApps is for app sites; a developer site lists apps in developer.apps');
    }
    return {
        kind: 'developer',
        ...common,
        developer: parseDeveloper(raw.developer, common.languages),
        repository: optionalString(raw, 'repository'),
    };
}

/** Validates an app's `gjsify.site` and applies defaults; the error names the offending key. */
export function parseSiteConfig(manifest: RootManifest): SiteConfig {
    const raw = siteBlock(manifest);
    if (raw.developer !== undefined) throw new Error('gjsify.site describes a developer site, not an app');
    const common = parseCommon(raw, undefined);
    const components = parseComponents(raw);

    return {
        kind: 'app',
        ...common,
        metainfo: requireString(raw, 'metainfo'),
        repository: requireString(raw, 'repository'),
        flathub: optionalString(raw, 'flathub'),
        webApp: optionalString(raw, 'webApp'),
        translations: optionalString(raw, 'translations'),
        icon: optionalString(raw, 'icon'),
        components,
        downloads: parseDownloads(raw, components),
        releaseAssets: parseReleaseAssets(raw),
        relatedApps: parseRelatedApps(raw.relatedApps, 'gjsify.site.relatedApps'),
        developerUrl:
            raw.developerUrl === undefined
                ? undefined
                : httpUrl(requireString(raw, 'developerUrl'), 'gjsify.site.developerUrl'),
    };
}

/** The `kind` labels the support page knows by name; the page catalogues translate them. */
export const SUPPORT_KIND_LABELS = ['GitHub Sponsors', 'Liberapay', 'PayPal'] as const;
