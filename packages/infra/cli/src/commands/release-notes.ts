// `gjsify release-notes [release] [--compare] [--metainfo <path>]`
//
// Prints one `releases` entry as GitHub Markdown, so a release workflow can pass
// it to `gh release create --notes-file -` instead of an empty body. Exits 1 when
// the version has no entry or no description: a release job must fail loudly
// rather than publish nothing.

import { Config } from '../config.js';
import type { Command } from '../types/index.js';
import { readPackageJson } from '../utils/pkg-json.js';
import { renderReleaseNotes, resolveReleases, stripVersionPrefix } from '../utils/release-notes.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface ReleaseNotesOptions {
    release?: string;
    compare?: boolean;
    metainfo?: string;
}

export const releaseNotesCommand: Command<unknown, ReleaseNotesOptions> = {
    command: 'release-notes [release]',
    description:
        'Print the `releases` entry for a version as GitHub Markdown (from the config or a metainfo file). Fails when there is no entry or no description.',
    builder: (yargs) =>
        yargs
            .positional('release', {
                description: 'Version or tag (a leading `v` is accepted). Default: the version in package.json.',
                type: 'string',
            })
            .option('compare', {
                description:
                    'Append a `**Full changelog:**` compare link to the previous entry (needs `vcsBrowserUrl`).',
                type: 'boolean',
                default: false,
            })
            .option('metainfo', {
                description:
                    'Read the `<release>` entries from this AppStream metainfo file instead of the config. ' +
                    'Default without `releases` in the config: the file named by `gjsify.site.metainfo`.',
                type: 'string',
            }),
    handler: async (args) => {
        const projectDir = process.cwd();
        try {
            const config = await new Config().forCommand(projectDir);
            const ship = config.ship ?? {};
            const flatpak = config.flatpak ?? {};
            const version = args.release ?? readPackageJson(join(projectDir, 'package.json'))?.version;
            if (!version) throw new Error('no version given and package.json has none');
            const { releases, source } = resolveReleases({
                metainfo: args.metainfo,
                configReleases: ship.releases ?? flatpak.releases,
                siteMetainfo: config.site?.metainfo,
                readMetainfo: (path) => {
                    try {
                        return readFileSync(resolve(projectDir, path), 'utf8');
                    } catch {
                        throw new Error(`cannot read the metainfo file ${path}`);
                    }
                },
            });
            const repoUrl = args.compare === true ? (ship.vcsBrowserUrl ?? flatpak.vcsBrowserUrl) : undefined;
            process.stdout.write(
                renderReleaseNotes({ releases, source, version: stripVersionPrefix(version), repoUrl }),
            );
        } catch (err) {
            process.stderr.write(`gjsify release-notes: ${err instanceof Error ? err.message : String(err)}\n`);
            return process.exit(1);
        }
    },
};
