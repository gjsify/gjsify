// What each store accepts, with the page that says so. `verified: false` marks a number that no
// first-party document states (ADR 0135 lists them); the check still enforces it, because an
// unverified ceiling that is too low is a message to fix, while one that is too high ships a rejection.

export type Store = 'cws' | 'edge' | 'amo';
export const STORES: readonly Store[] = ['cws', 'edge', 'amo'];

export type TextField = 'name' | 'summary' | 'description';

export interface TextLimit {
    min?: number;
    max?: number;
    url: string;
    verified: boolean;
}

export interface Size {
    width: number;
    height: number;
}

/** A form field of the store's dashboard; `manual` ones cannot be derived from the metainfo. */
export type FormKey =
    | 'name'
    | 'summary'
    | 'description'
    | 'category'
    | 'language'
    | 'icon'
    | 'screenshots'
    | 'promoSmall'
    | 'promoMarquee'
    | 'privacyUrl'
    | 'singlePurpose'
    | 'permissions'
    | 'searchTerms'
    | 'supportUrl'
    | 'homepage'
    | 'dataUsage'
    | 'certificationNotes';

export interface FormFieldSpec {
    key: FormKey;
    label: string;
    required: boolean;
    manual?: boolean;
}

export interface PromoSpec extends Size {
    kind: 'small' | 'marquee';
    required: boolean;
    url: string;
}

export interface StoreSpec {
    label: string;
    text: Partial<Record<TextField, TextLimit>>;
    /** Screenshot canvas, count, and the page that states them. */
    screenshots: Size & { min: number; max: number; url: string };
    /** Square icon edge in pixels. */
    icon: { size: number; url: string };
    /** Summaries may not contain URLs (AMO enforces this server-side). */
    summaryHasNoUrls?: boolean;
    /** Emit `description.html` next to the plain text. */
    descriptionHtml?: boolean;
    /** Needs one justification per permission and a single-purpose statement. */
    justifiesPermissions: boolean;
    categoryRequired: boolean;
    /** Promo tiles the dashboard takes; empty when the store has none. */
    promo: PromoSpec[];
    /** The dashboard asks for search terms. */
    searchTerms?: boolean;
    /** The dashboard's form, in the order a person fills it in. */
    form: FormFieldSpec[];
}

/** Accepts `cws,edge`, `all` or one store; anything else names the offender. */
export function parseStores(value: string): Store[] {
    if (value === 'all') return [...STORES];
    const requested = value.split(',').map((part) => part.trim());
    const unknown = requested.filter((part) => !STORES.includes(part as Store));
    if (unknown.length > 0 || requested.length === 0)
        throw new Error(
            `Unknown store "${unknown.join(', ') || value}": use ${STORES.join(', ')}, a comma list or all`,
        );
    return STORES.filter((store) => requested.includes(store));
}

const CWS_IMAGES = 'https://developer.chrome.com/docs/webstore/images';
const EDGE_PUBLISH = 'https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension';
const AMO_LISTING = 'https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/';

export const STORE_SPECS: Record<Store, StoreSpec> = {
    cws: {
        label: 'Chrome Web Store',
        text: {
            name: {
                max: 75,
                url: 'https://developer.chrome.com/docs/extensions/reference/manifest/name',
                verified: true,
            },
            summary: {
                max: 132,
                url: 'https://developer.chrome.com/docs/extensions/reference/manifest/description',
                verified: true,
            },
            description: {
                max: 16000,
                url: 'https://developer.chrome.com/docs/webstore/cws-dashboard-listing',
                verified: false,
            },
        },
        screenshots: { width: 1280, height: 800, min: 1, max: 5, url: CWS_IMAGES },
        icon: { size: 128, url: CWS_IMAGES },
        justifiesPermissions: true,
        categoryRequired: true,
        promo: [
            { kind: 'small', width: 440, height: 280, required: true, url: CWS_IMAGES },
            { kind: 'marquee', width: 1400, height: 560, required: false, url: CWS_IMAGES },
        ],
        form: [
            { key: 'name', label: 'Name', required: true },
            { key: 'summary', label: 'Summary', required: true },
            { key: 'description', label: 'Description', required: true },
            { key: 'category', label: 'Category', required: true },
            { key: 'language', label: 'Language', required: true },
            { key: 'icon', label: 'Store icon', required: true },
            { key: 'screenshots', label: 'Screenshots', required: true },
            { key: 'promoSmall', label: 'Small promo tile', required: true },
            { key: 'promoMarquee', label: 'Marquee promo tile', required: false },
            { key: 'singlePurpose', label: 'Single purpose', required: true },
            { key: 'permissions', label: 'Permission justifications', required: true },
            { key: 'dataUsage', label: 'Data usage disclosures', required: true, manual: true },
            { key: 'privacyUrl', label: 'Privacy policy URL', required: true },
            { key: 'supportUrl', label: 'Support URL', required: false },
        ],
    },
    edge: {
        label: 'Edge Add-ons',
        text: {
            // Name and short description are read from the manifest; the manifest ceilings are Chromium's.
            name: { max: 75, url: EDGE_PUBLISH, verified: false },
            summary: { max: 132, url: EDGE_PUBLISH, verified: false },
            description: { min: 250, max: 10000, url: EDGE_PUBLISH, verified: true },
        },
        screenshots: { width: 1280, height: 800, min: 1, max: 6, url: EDGE_PUBLISH },
        icon: { size: 300, url: EDGE_PUBLISH },
        justifiesPermissions: true,
        categoryRequired: true,
        promo: [
            { kind: 'small', width: 440, height: 280, required: false, url: EDGE_PUBLISH },
            { kind: 'marquee', width: 1400, height: 560, required: false, url: EDGE_PUBLISH },
        ],
        searchTerms: true,
        form: [
            { key: 'name', label: 'Name', required: true },
            { key: 'summary', label: 'Short description', required: true },
            { key: 'description', label: 'Description', required: true },
            { key: 'category', label: 'Category', required: true },
            { key: 'language', label: 'Language', required: true },
            { key: 'icon', label: 'Extension logo', required: true },
            { key: 'screenshots', label: 'Screenshots', required: true },
            { key: 'promoSmall', label: 'Small tile', required: false },
            { key: 'promoMarquee', label: 'Large tile', required: false },
            { key: 'searchTerms', label: 'Search terms', required: false },
            { key: 'singlePurpose', label: 'Single purpose', required: true },
            { key: 'permissions', label: 'Permission justifications', required: true },
            { key: 'certificationNotes', label: 'Notes for certification', required: false, manual: true },
            { key: 'privacyUrl', label: 'Privacy policy URL', required: false },
            { key: 'supportUrl', label: 'Support URL', required: false },
        ],
    },
    amo: {
        label: 'Firefox Add-ons (AMO)',
        text: {
            name: { max: 50, url: AMO_LISTING, verified: true },
            summary: { max: 250, url: AMO_LISTING, verified: true },
        },
        screenshots: { width: 1280, height: 800, min: 1, max: 10, url: AMO_LISTING },
        icon: { size: 128, url: 'https://mozilla.github.io/addons-server/topics/api/addons.html' },
        summaryHasNoUrls: true,
        descriptionHtml: true,
        justifiesPermissions: false,
        categoryRequired: false,
        promo: [],
        form: [
            { key: 'name', label: 'Name', required: true },
            { key: 'summary', label: 'Summary', required: true },
            { key: 'description', label: 'Description', required: true },
            { key: 'language', label: 'Language', required: true },
            { key: 'category', label: 'Categories', required: false },
            { key: 'icon', label: 'Icon', required: false },
            { key: 'screenshots', label: 'Screenshots', required: false },
            { key: 'homepage', label: 'Homepage', required: false },
            { key: 'supportUrl', label: 'Support site', required: false },
            { key: 'privacyUrl', label: 'Privacy policy', required: false },
        ],
    },
};
