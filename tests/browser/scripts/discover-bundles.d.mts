export interface BundleInfo {
    packageName: string;
    url: string;
}

export function discoverBundles(): BundleInfo[];
