import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
    ExtensionBrowser,
    ExtensionData,
    ExtensionFamily,
    ExtensionPermission,
    SiteExtensionConfig,
} from './types.js';

/*
 * Manifest parsing, locale resolution and permission classification, free of rendering and of the
 * file system apart from `loadExtension`: a later developer-only mode renders one preview per store
 * from the `ExtensionData` this produces, so nothing here may know how it is shown.
 */

type Raw = Record<string, unknown>;

/** `_locales/<dir>/messages.json`, keyed by the directory name (`en`, `pt_BR`). */
export type MessageCatalogs = Record<string, Record<string, { message?: string } | undefined>>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** Locale directories to try for a site language, most specific first: `pt-BR` → `pt_BR`, `pt`. */
export function localeCandidates(language: string, available: readonly string[]): string[] {
    const underscored = language.replace(/-/g, '_');
    const wanted = [language, underscored, underscored.split('_')[0] as string];
    const lower = new Map(available.map((dir) => [dir.toLowerCase(), dir]));
    return [
        ...new Set(wanted.map((candidate) => lower.get(candidate.toLowerCase())).filter((dir) => dir !== undefined)),
    ];
}

/**
 * Replaces every `__MSG_key__` for a page language: the language's catalogue, then the manifest's
 * `default_locale`. A key found nowhere fails the build, as the browser would show it raw.
 */
export function resolveMessages(
    text: string,
    language: string,
    catalogs: MessageCatalogs,
    defaultLocale: string | undefined,
): string {
    if (!text.includes('__MSG_')) return text;
    const dirs = Object.keys(catalogs);
    if (dirs.length === 0) {
        throw new Error(`"${text}" is a __MSG_ reference, but gjsify.site.extension.locales is not set`);
    }
    const order = [
        ...localeCandidates(language, dirs),
        ...(defaultLocale ? localeCandidates(defaultLocale, dirs) : []),
    ];
    return text.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (_match, key: string) => {
        for (const dir of order) {
            const message = (catalogs[dir] as MessageCatalogs[string])[key]?.message;
            if (message !== undefined) return message;
        }
        throw new Error(`The extension message "${key}" is in none of the _locales (${dirs.join(', ')})`);
    });
}

const HOST_PATTERN = /^(\*|https?|wss?|ftp|file|urn):\/\//;

/** Site patterns, as opposed to API names; MV2 mixes them into `permissions`. */
export const isHostPermission = (name: string): boolean => name === '<all_urls>' || HOST_PATTERN.test(name);

/** The patterns that mean "every website", for which a page says so instead of printing the pattern. */
export const isAllSites = (name: string): boolean =>
    ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'].includes(name);

/** What one manifest asks for, split by when. MV2 and MV3 spellings both end up in the same two lists. */
export function manifestPermissions(manifest: Raw): { required: string[]; optional: string[] } {
    return {
        required: [...stringList(manifest.permissions), ...stringList(manifest.host_permissions)],
        optional: [...stringList(manifest.optional_permissions), ...stringList(manifest.optional_host_permissions)],
    };
}

/**
 * Merges the browsers' permission lists. A permission one browser requires and another only
 * offers sits in both lists, each with the browsers it applies to. API names come before hosts.
 */
export function classifyPermissions(
    manifests: ReadonlyArray<{ family: ExtensionFamily; manifest: Raw }>,
): Pick<ExtensionData, 'required' | 'optional'> {
    const merge = (pick: 'required' | 'optional'): ExtensionPermission[] => {
        const byName = new Map<string, ExtensionPermission>();
        for (const { family, manifest } of manifests) {
            for (const name of manifestPermissions(manifest)[pick]) {
                const known = byName.get(name);
                if (known) {
                    if (!known.families.includes(family)) known.families.push(family);
                } else byName.set(name, { name, host: isHostPermission(name), families: [family] });
            }
        }
        const all = [...byName.values()];
        return [...all.filter((entry) => !entry.host), ...all.filter((entry) => entry.host)];
    };
    return { required: merge('required'), optional: merge('optional') };
}

/** Firefox's `data_collection_permissions.required: ["none"]` is the extension's own declaration. */
export function declaresNoDataCollection(manifest: Raw): boolean {
    const settings = isRecord(manifest.browser_specific_settings) ? manifest.browser_specific_settings : {};
    const gecko = isRecord(settings.gecko) ? settings.gecko : {};
    const declaration = gecko.data_collection_permissions;
    if (!isRecord(declaration)) return false;
    const required = stringList(declaration.required);
    return required.length === 1 && required[0] === 'none';
}

function minimumVersion(family: ExtensionFamily, manifest: Raw): string | undefined {
    if (family === 'firefox') {
        const settings = manifest.browser_specific_settings ?? manifest.applications;
        const gecko = isRecord(settings) && isRecord(settings.gecko) ? settings.gecko : {};
        return typeof gecko.strict_min_version === 'string' ? gecko.strict_min_version : undefined;
    }
    return typeof manifest.minimum_chrome_version === 'string' ? manifest.minimum_chrome_version : undefined;
}

/** One manifest as a listing needs it; texts are resolved once per language. */
export function parseExtensionManifest(
    family: ExtensionFamily,
    manifest: Raw,
    languages: readonly string[],
    catalogs: MessageCatalogs,
    where = `${family} manifest`,
): ExtensionBrowser {
    const defaultLocale = typeof manifest.default_locale === 'string' ? manifest.default_locale : undefined;
    const texts = (key: string, required: boolean): Record<string, string> | undefined => {
        const value = manifest[key];
        if (typeof value !== 'string' || value === '') {
            if (required) throw new Error(`The ${where} has no "${key}"`);
            return undefined;
        }
        return Object.fromEntries(
            languages.map((lang) => [lang, resolveMessages(value, lang, catalogs, defaultLocale)]),
        );
    };
    const manifestVersion = manifest.manifest_version;
    if (manifestVersion !== 2 && manifestVersion !== 3) throw new Error(`The ${where} has no manifest_version 2 or 3`);
    if (typeof manifest.version !== 'string') throw new Error(`The ${where} has no "version"`);
    return {
        family,
        version: manifest.version,
        manifestVersion,
        minVersion: minimumVersion(family, manifest),
        name: texts('name', true) as Record<string, string>,
        description: texts('description', false) ?? Object.fromEntries(languages.map((lang) => [lang, ''])),
        shortName: texts('short_name', false),
        declaresNoDataCollection: declaresNoDataCollection(manifest),
    };
}

/** Parsed manifests → the typed object the page renders. Browsers keep the configured order. */
export function buildExtensionData(
    config: SiteExtensionConfig,
    manifests: ReadonlyArray<{ family: ExtensionFamily; manifest: Raw }>,
    languages: readonly string[],
    catalogs: MessageCatalogs,
): ExtensionData {
    const browsers = manifests.map(({ family, manifest }) =>
        parseExtensionManifest(family, manifest, languages, catalogs),
    );
    return {
        browsers,
        ...classifyPermissions(manifests),
        collectsNoData:
            browsers.some((browser) => browser.declaresNoDataCollection) &&
            browsers
                .filter((browser) => browser.family === 'firefox')
                .every((browser) => browser.declaresNoDataCollection),
        locales: Object.keys(catalogs).sort(),
        component: config.component,
        explanations: config.permissions,
    };
}

/** Reads the built manifests and `_locales`; a missing manifest means the extension is not built yet. */
export async function loadExtension(
    config: SiteExtensionConfig,
    root: string,
    languages: readonly string[],
): Promise<ExtensionData> {
    const manifests: Array<{ family: ExtensionFamily; manifest: Raw }> = [];
    for (const [family, path] of Object.entries(config.manifests) as Array<[ExtensionFamily, string]>) {
        const file = resolve(root, path);
        if (!existsSync(file)) {
            throw new Error(
                `gjsify.site.extension.manifests.${family} points to "${path}", which does not exist: build the extension first`,
            );
        }
        const manifest = JSON.parse(await readFile(file, 'utf8')) as unknown;
        if (!isRecord(manifest)) throw new Error(`"${path}" is not a manifest object`);
        manifests.push({ family, manifest });
    }

    const catalogs: MessageCatalogs = {};
    if (config.locales !== undefined) {
        const dir = resolve(root, config.locales);
        if (!existsSync(dir))
            throw new Error(`gjsify.site.extension.locales points to "${config.locales}", which does not exist`);
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const file = resolve(dir, entry.name, 'messages.json');
            if (entry.isDirectory() && existsSync(file)) {
                catalogs[entry.name] = JSON.parse(await readFile(file, 'utf8')) as MessageCatalogs[string];
            }
        }
    }
    return buildExtensionData(config, manifests, languages, catalogs);
}
