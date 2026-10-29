import { recordedArtifact } from './downloads.js';
import { fetchJson, HttpError, type NetworkOptions } from './network.js';
import type { LatestRelease, ReleaseAsset } from './types.js';

interface RawAsset {
    name?: unknown;
    size?: unknown;
    download_count?: unknown;
    browser_download_url?: unknown;
    digest?: unknown;
}

/** GitHub spells the digest `sha256:<hex>`; any other algorithm is not one a release record carries. */
function sha256Of(digest: unknown): string | undefined {
    if (typeof digest !== 'string') return undefined;
    const match = /^sha256:([0-9a-f]{64})$/i.exec(digest);
    return match ? match[1]!.toLowerCase() : undefined;
}

/** Parses the GitHub REST `releases/latest` payload; anything malformed throws so the caller can warn and degrade. */
export function parseLatestRelease(payload: unknown): LatestRelease {
    const release = payload as {
        tag_name?: unknown;
        name?: unknown;
        published_at?: unknown;
        html_url?: unknown;
        assets?: unknown;
    };
    if (typeof release?.tag_name !== 'string' || !Array.isArray(release.assets)) {
        throw new Error('Unexpected GitHub release payload');
    }
    const assets: ReleaseAsset[] = (release.assets as RawAsset[]).flatMap((asset) =>
        typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
            ? [
                  {
                      name: asset.name,
                      size: typeof asset.size === 'number' ? asset.size : 0,
                      downloadUrl: asset.browser_download_url,
                      downloadCount: typeof asset.download_count === 'number' ? asset.download_count : 0,
                      ...(sha256Of(asset.digest) ? { sha256: sha256Of(asset.digest) } : {}),
                  },
              ]
            : [],
    );
    return {
        tag: release.tag_name,
        name: typeof release.name === 'string' && release.name ? release.name : release.tag_name,
        publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
        url: typeof release.html_url === 'string' ? release.html_url : '',
        assets,
    };
}

/**
 * Fetches every release record among `assets`, by the artifact it describes. A record that does not
 * download is reported through `warn` and left out, which makes its artifact `unsigned` — the page
 * then shows one hint too many rather than one too few.
 */
export async function fetchReleaseRecords(
    assets: readonly ReleaseAsset[],
    options: NetworkOptions,
    warn: (message: string) => void,
): Promise<Map<string, unknown>> {
    const records = new Map<string, unknown>();
    await Promise.all(
        assets.map(async (asset) => {
            const artifact = recordedArtifact(asset.name);
            if (artifact === undefined) return;
            try {
                records.set(artifact, await fetchJson(asset.downloadUrl, { Accept: 'application/json' }, options));
            } catch (error) {
                warn(
                    `Could not fetch the release record ${asset.name} (${String(error)}); treating ${artifact} as unsigned`,
                );
            }
        }),
    );
    return records;
}

/**
 * Fetches the latest published (non-draft, non-prerelease) release; `null` when the repository has
 * none yet, which is a state and not an error. `token` raises the rate limit.
 */
export async function fetchLatestRelease(
    repository: string,
    token: string | undefined,
    options: NetworkOptions,
): Promise<LatestRelease | null> {
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${repository.replace('/', '-')}-website`,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
        return parseLatestRelease(
            await fetchJson(`https://api.github.com/repos/${repository}/releases/latest`, headers, options),
        );
    } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
    }
}
