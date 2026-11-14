import type { StoreEntry } from './build.js';
import { STORE_SPECS, type FormKey, type Size, type Store } from './limits.js';
import { characters } from './text.js';

export type FieldStatus = 'derived' | 'manual' | 'missing' | 'omitted';

/** Paths relative to the store's directory. */
export interface StoreFiles {
    icon?: string;
    screenshots: string[];
    promo: { small?: string; marquee?: string };
}

export interface ManifestField {
    key: FormKey;
    label: string;
    required: boolean;
    /** `manual`: the dashboard asks for it and nothing here can know the answer. */
    status: FieldStatus;
    limit?: { min?: number; max?: number; unit: 'characters' };
    size?: Size;
    count?: { min: number; max: number };
    /** Short values per language (`*` for those that do not depend on it). */
    values?: Record<string, string | string[]>;
    files?: string[];
    /** Characters per language, for the text fields. */
    lengths?: Record<string, number>;
}

/**
 * What a submission to one store consists of: every dashboard field, its limits and the files that
 * fill it. A preflight for `webext submit`, not an API payload: neither Chrome Web Store nor Edge
 * takes listing text through its API (ADR 0135).
 */
export interface StoreManifest {
    version: 1;
    app: string;
    store: Store;
    label: string;
    languages: string[];
    fields: ManifestField[];
}

const TEXT_FILES = { name: 'name.txt', summary: 'summary.txt', description: 'description.txt' } as const;

export interface StoreManifestInput {
    app: string;
    store: Store;
    entries: Readonly<Record<string, StoreEntry>>;
    files: StoreFiles;
}

export function storeManifest({ app, store, entries, files }: StoreManifestInput): StoreManifest {
    const spec = STORE_SPECS[store];
    const languages = Object.keys(entries);
    const all = Object.entries(entries);
    const perLanguage = <T>(pick: (entry: StoreEntry) => T | undefined): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [language, entry] of all) {
            const value = pick(entry);
            if (value !== undefined) out[language] = value;
        }
        return out;
    };
    const everyLanguage = (values: Record<string, unknown>) => languages.every((language) => language in values);
    const promoFor = (key: FormKey) => {
        const kind = key === 'promoSmall' ? 'small' : 'marquee';
        return { tile: spec.promo.find((promo) => promo.kind === kind), file: files.promo[kind] };
    };

    const fields = spec.form.map((field): ManifestField => {
        const { key, label, required } = field;
        if (field.manual) return { key, label, required, status: 'manual' };
        let details: Omit<ManifestField, 'key' | 'label' | 'required' | 'status'> = {};
        let present: boolean;
        switch (key) {
            case 'name':
            case 'summary':
            case 'description': {
                const lengths = perLanguage((entry) => (entry[key] === '' ? undefined : characters(entry[key])));
                const limit = spec.text[key];
                details = {
                    ...(limit ? { limit: { min: limit.min, max: limit.max, unit: 'characters' as const } } : {}),
                    files: languages.map((language) => `${language}/${TEXT_FILES[key]}`),
                    lengths,
                };
                present = everyLanguage(lengths);
                break;
            }
            case 'category': {
                const values = perLanguage((entry) => entry.category);
                details = { values };
                present = everyLanguage(values);
                break;
            }
            case 'language':
                details = { values: { '*': languages } };
                present = languages.length > 0;
                break;
            case 'icon':
                details = {
                    size: { width: spec.icon.size, height: spec.icon.size },
                    files: files.icon ? [files.icon] : [],
                };
                present = files.icon !== undefined;
                break;
            case 'screenshots':
                details = {
                    size: { width: spec.screenshots.width, height: spec.screenshots.height },
                    count: { min: spec.screenshots.min, max: spec.screenshots.max },
                    files: files.screenshots,
                };
                present = files.screenshots.length >= spec.screenshots.min;
                break;
            case 'promoSmall':
            case 'promoMarquee': {
                const { tile, file } = promoFor(key);
                details = {
                    ...(tile ? { size: { width: tile.width, height: tile.height } } : {}),
                    files: file ? [file] : [],
                };
                present = file !== undefined;
                break;
            }
            case 'singlePurpose': {
                const values = perLanguage((entry) => entry.singlePurpose || undefined);
                details = { values };
                present = everyLanguage(values);
                break;
            }
            case 'permissions': {
                details = {
                    files: languages.map((language) => `${language}/permissions.md`),
                    values: perLanguage((entry) => entry.permissions.map(({ permission }) => permission)),
                };
                present = all.every(([, entry]) =>
                    entry.permissions.every(({ justification }) => justification !== ''),
                );
                break;
            }
            case 'searchTerms': {
                const values = perLanguage((entry) => (entry.searchTerms?.length ? entry.searchTerms : undefined));
                details = { values };
                present = everyLanguage(values);
                break;
            }
            case 'privacyUrl':
            case 'supportUrl':
            case 'homepage': {
                const values = perLanguage((entry) => entry[key]);
                details = { values };
                present = everyLanguage(values);
                break;
            }
            default:
                present = false;
        }
        return { key, label, required, status: present ? 'derived' : required ? 'missing' : 'omitted', ...details };
    });
    return { version: 1, app, store, label: spec.label, languages, fields };
}
