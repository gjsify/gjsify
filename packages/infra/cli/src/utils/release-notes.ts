// GitHub-Markdown rendering of one `releases` entry, for `gjsify release-notes`.
//
// The AppStream `<release>` blocks and a GitHub release body describe the same
// release, so both read the one `releases` list in the config. The string →
// block normalisation is `stringToBlocks` from app-metadata.ts, not a second copy.

import type { DescriptionBlock } from '../types/config-data.js';
import { stringToBlocks } from './app-metadata.js';
import { parseMetainfoReleases } from './metainfo-releases.js';

export interface ReleaseEntry {
    version: string;
    date: string;
    description?: string | DescriptionBlock[];
}

/** Paragraphs → paragraphs, lists → `- ` items. Translator hints are dropped. */
export function descriptionToMarkdown(description: string | DescriptionBlock[]): string {
    const blocks = typeof description === 'string' ? stringToBlocks(description) : description;
    const out: string[] = [];
    for (const block of blocks) {
        if ('p' in block) {
            const text = block.p.trim().replace(/\s+/g, ' ');
            if (text) out.push(text);
        } else {
            const items = block.ul.map((item) => (typeof item === 'string' ? item : item.item).trim()).filter(Boolean);
            if (items.length) out.push(items.map((item) => `- ${item}`).join('\n'));
        }
    }
    return out.join('\n\n');
}

/** `v0.1.7` and `0.1.7` name the same release. */
export function stripVersionPrefix(version: string): string {
    return version.trim().replace(/^v/i, '');
}

export interface ReleasesSource {
    /** `--metainfo <path>`: wins over everything. */
    metainfo?: string;
    /** `ship.releases ?? flatpak.releases` from the config. */
    configReleases?: readonly ReleaseEntry[];
    /** `site.metainfo` from the config: read only when nothing above names releases. */
    siteMetainfo?: string;
    /** Reads a metainfo file; throws when it does not exist. */
    readMetainfo: (path: string) => string;
}

export interface ResolvedReleases {
    releases: readonly ReleaseEntry[] | undefined;
    /** Names the origin in error messages; unset for the config. */
    source?: string;
}

/** Lookup order: `--metainfo`, config `releases`, the metainfo the config names. */
export function resolveReleases(input: ReleasesSource): ResolvedReleases {
    const path = input.metainfo ?? (input.configReleases ? undefined : input.siteMetainfo);
    if (path === undefined) return { releases: input.configReleases };
    return { releases: parseMetainfoReleases(input.readMetainfo(path)), source: path };
}

export interface ReleaseNotesInput {
    releases: readonly ReleaseEntry[] | undefined;
    /** Where `releases` came from, for the error text. Default: the gjsify config. */
    source?: string;
    /** Requested version, with or without a leading `v`. */
    version: string;
    /** Append the compare link when set and a previous release exists. */
    repoUrl?: string;
}

/** Throws an `Error` whose message is meant to be printed as-is. */
export function renderReleaseNotes({ releases, source, version, repoUrl }: ReleaseNotesInput): string {
    const wanted = stripVersionPrefix(version);
    const list = releases ?? [];
    const index = list.findIndex((r) => stripVersionPrefix(r.version) === wanted);
    if (index < 0) {
        const none = source === undefined ? 'no `releases` configured' : 'no `<release>` entries';
        throw new Error(
            `no \`releases\` entry for version ${wanted} in ${source ?? 'the gjsify config'}` +
                (list.length ? ` (found: ${list.map((r) => r.version).join(', ')})` : ` (${none})`),
        );
    }
    const entry = list[index]!;
    const body = entry.description === undefined ? '' : descriptionToMarkdown(entry.description);
    if (!body) throw new Error(`the \`releases\` entry for version ${wanted} has no description`);

    // Most recent first, so the previous release is the next entry.
    const previous = list[index + 1];
    if (!repoUrl || !previous) return `${body}\n`;
    const base = repoUrl.replace(/\/+$/, '');
    const compare = `${base}/compare/v${stripVersionPrefix(previous.version)}...v${wanted}`;
    return `${body}\n\n**Full changelog:** ${compare}\n`;
}
