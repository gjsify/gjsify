import type { Catalog } from '../site-data/po.js';
import { pickByLanguage, resolveLocalized, translator } from '../site-data/po.js';
import type { Localized, Metainfo } from '../site-data/types.js';
import type { ListingConfig } from './config.js';
import { STORE_SPECS, STORES, type Store, type TextField } from './limits.js';
import { characters, descriptionHtml, descriptionText } from './text.js';

export interface StoreEntry {
    name: string;
    summary: string;
    description: string;
    descriptionHtml?: string;
    singlePurpose: string;
    permissions: Array<{ permission: string; justification: string }>;
    category?: string;
    privacyUrl?: string;
    /** `<url type="homepage">`; the donation URL is never carried (ADR 0113). */
    homepage?: string;
    supportUrl?: string;
    /** Edge's search terms, from the metainfo keywords. */
    searchTerms?: string[];
}

export interface Issue {
    store: Store;
    language: string;
    field: string;
    message: string;
}

export interface ListingModel {
    stores: Partial<Record<Store, Record<string, StoreEntry>>>;
    issues: Issue[];
    warnings: string[];
    /** Every msgid the config blocks asked a catalogue for, for `--pot`. */
    msgids: string[];
}

export interface ListingInput {
    metainfo: Metainfo;
    config: ListingConfig;
    catalogs: Readonly<Record<string, Catalog>>;
    stores?: readonly Store[];
}

/** Error text naming field, store, language and limit. */
export function checkEntry(store: Store, language: string, entry: StoreEntry): Issue[] {
    const spec = STORE_SPECS[store];
    const issues: Issue[] = [];
    const add = (field: string, message: string) =>
        issues.push({ store, language, field, message: `${spec.label} [${language}] ${field}: ${message}` });

    for (const field of ['name', 'summary', 'description'] as TextField[]) {
        const limit = spec.text[field];
        const value = entry[field];
        if (value === '') {
            add(field, 'is empty');
            continue;
        }
        if (!limit) continue;
        const count = characters(value);
        const note = `${limit.verified ? '' : ' (limit not confirmed by first-party docs) '}${limit.url}`;
        if (limit.max !== undefined && count > limit.max)
            add(field, `${count} characters, limit ${limit.max} — ${note}`);
        if (limit.min !== undefined && count < limit.min)
            add(field, `${count} characters, minimum ${limit.min} — ${note}`);
    }
    if (spec.summaryHasNoUrls && /https?:\/\/|www\./i.test(entry.summary)) add('summary', 'must not contain a URL');
    if (spec.justifiesPermissions) {
        if (entry.singlePurpose === '') add('singlePurpose', 'is empty (set gjsify.webext.listing.singlePurpose)');
        for (const { permission, justification } of entry.permissions) {
            if (justification === '') add(`permissions.${permission}`, 'has no justification');
        }
    }
    if (spec.categoryRequired && !entry.category)
        add('category', `is not set (gjsify.webext.listing.category.${store})`);
    return issues;
}

export function buildListingModel({ metainfo, config, catalogs, stores = STORES }: ListingInput): ListingModel {
    const model: ListingModel = { stores: {}, issues: [], warnings: [], msgids: [] };
    const used = new Set<string>();

    for (const language of config.languages) {
        const catalog = catalogs[language];
        const isSource = language === config.sourceLanguage;
        const lookup = translator(catalog);
        // A config string is a msgid; English needs no catalogue, another language warns once per msgid.
        const configText = (msgid: string | undefined): string => {
            if (msgid === undefined) return '';
            used.add(msgid);
            if (!isSource && !catalog?.has(msgid))
                model.warnings.push(`"${language}" has no translation of "${msgid}"`);
            return lookup(msgid);
        };
        const app = (text: Localized): string => {
            if (!isSource && pickByLanguage(text.byLanguage, language) === undefined && !catalog?.has(text.source)) {
                model.warnings.push(`"${language}" has no translation of the app text "${text.source.slice(0, 40)}…"`);
            }
            return isSource ? text.source : resolveLocalized(text, language, catalog);
        };

        const description = metainfo.description;
        const base = {
            name: app(metainfo.name),
            summary: app(metainfo.summary),
            description: descriptionText(description, app),
            singlePurpose: configText(config.singlePurpose),
            permissions: Object.entries(config.permissions).map(([permission, msgid]) => ({
                permission,
                justification: configText(msgid),
            })),
            privacyUrl:
                metainfo.urls.privacy ??
                config.privacyUrl ??
                (config.siteUrl ? `${config.siteUrl}${language}/privacy/` : undefined),
            homepage: metainfo.urls.homepage,
            supportUrl: metainfo.urls.bugtracker,
        };
        for (const store of stores) {
            const spec = STORE_SPECS[store];
            const entry: StoreEntry = {
                ...base,
                ...(spec.descriptionHtml ? { descriptionHtml: descriptionHtml(description, app) } : {}),
                category: config.category[store],
                ...(spec.searchTerms ? { searchTerms: metainfo.keywords.map(app) } : {}),
            };
            (model.stores[store] ??= {})[language] = entry;
            model.issues.push(...checkEntry(store, language, entry));
        }
    }
    model.warnings = [...new Set(model.warnings)];
    model.msgids = [...used];
    return model;
}
