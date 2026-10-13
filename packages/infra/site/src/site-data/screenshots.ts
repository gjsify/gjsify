import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

import { fetchBinary, type NetworkOptions } from './network.js';
import type { Metainfo, Screenshot } from './types.js';

const RAW_GITHUB = 'https://raw.githubusercontent.com/';

/**
 * The repo-relative path a `raw.githubusercontent.com` URL points at, or `undefined` when the URL
 * belongs to some other repository or host.
 *
 * A metainfo pins its screenshots to a tag, so the URL serves the artwork of the release it was
 * written for. The checkout being built carries that same file — and, between releases, a newer
 * one — so reading it locally is both faster and more truthful than downloading the tagged copy.
 */
export function repositoryPath(url: string, repository: string): string | undefined {
    if (!url.startsWith(RAW_GITHUB)) return undefined;
    const [owner, name, ...rest] = urlPath(url).split('/').slice(1);
    if (!owner || !name || rest.length === 0) return undefined;
    if (`${owner}/${name}`.toLowerCase() !== repository.toLowerCase()) return undefined;
    // The ref is one segment (a branch, a commit) or three (`refs/tags/v1.2.0`, which is what the
    // GitHub web UI copies and what metainfo files therefore tend to carry).
    const drop = rest[0] === 'refs' && rest.length > 3 ? 3 : 1;
    const path = rest.slice(drop).join('/');
    return path === '' ? undefined : decodeURIComponent(path);
}

/** The path of a URL, leading slash included, without query or fragment. */
function urlPath(url: string): string {
    const host = url.replace(/^[a-z]+:\/\//i, '');
    const slash = host.indexOf('/');
    return slash === -1 ? '/' : (host.slice(slash).split(/[?#]/)[0] as string);
}

/** Flattens a path into one filename stem, so `misc/1.png` and `doc/1.png` stay apart. */
export function imageSlug(path: string): string {
    return path
        .replace(/\.[^./]+$/, '')
        .replace(/[^a-zA-Z0-9.]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

export interface ScreenshotOptions {
    /** Repository root, which a `raw.githubusercontent.com` URL into this repository is resolved against. */
    root: string;
    /** `owner/name` of this repository, from `gjsify.site.repository`. */
    repository: string;
    /** Where artwork from other hosts is kept, so a later offline build finds it again. */
    cacheDir?: string;
    /** No downloads; a screenshot with no local or cached file is skipped with a warning. */
    offline?: boolean;
    network?: NetworkOptions;
    warn?: (message: string) => void;
}

/**
 * The metainfo `<screenshots>` list with every image located on disk — the same artwork Flathub
 * shows, in the same order, so the page doubles as a preview of the store listing.
 *
 * A screenshot whose file cannot be found or fetched is skipped with a warning: a page missing one
 * image is better than no page at all, and the warning names what to fix.
 */
export async function resolveScreenshots(metainfo: Metainfo, options: ScreenshotOptions): Promise<Screenshot[]> {
    const warn = options.warn ?? (() => {});
    const store = options.cacheDir ?? join(tmpdir(), 'gjsify-site-screenshots');
    const screenshots: Screenshot[] = [];

    for (const [index, entry] of metainfo.screenshots.entries()) {
        const label = `Screenshot ${index + 1}`;
        if (!entry.url) {
            warn(`${label} of the metainfo has no <image>; skipping it`);
            continue;
        }
        const repoPath = repositoryPath(entry.url, options.repository);
        const slug = imageSlug(repoPath ?? urlPath(entry.url));
        const screenshot = { caption: entry.caption, url: entry.url, slug };

        if (repoPath !== undefined) {
            const file = resolve(options.root, repoPath);
            if (!existsSync(file)) {
                warn(`${label} points at "${repoPath}" of this repository, which does not exist; skipping it`);
                continue;
            }
            screenshots.push({ ...screenshot, file });
            continue;
        }

        const file = join(store, `${slug}${extname(urlPath(entry.url)) || '.png'}`);
        if (!existsSync(file)) {
            if (options.offline) {
                warn(`${label} is hosted at ${entry.url}; skipping it because this build is offline`);
                continue;
            }
            try {
                await mkdir(store, { recursive: true });
                await writeFile(file, await fetchBinary(entry.url, options.network ?? {}));
            } catch (error) {
                warn(`Could not download ${label} from ${entry.url} (${String(error)}); skipping it`);
                continue;
            }
        }
        screenshots.push({ ...screenshot, file });
    }

    return screenshots;
}
