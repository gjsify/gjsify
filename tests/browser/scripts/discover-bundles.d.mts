export interface BundleInfo {
    packageName: string;
    /**
     * Pillar label derived from the bundle's location under `packages/<pillar>`
     * — one of `web` / `dom` / `node`. Used in the Playwright spec title so
     * the HTML reporter can distinguish per-pillar bundles when the `node`
     * pillar joins the existing `web` + `dom` discovery.
     */
    pillar: string;
    url: string;
}

export function discoverBundles(): BundleInfo[];
