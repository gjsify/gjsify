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
    },
};
