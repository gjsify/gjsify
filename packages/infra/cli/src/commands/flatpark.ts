// `gjsify flatpark [project] --out <dir>` — write the FlatPark package directory
// (`registry/<app-id>/`) for a project that already ran `gjsify ship`.
//
// It only WRITES FILES. No pull request, no push, no network, no hashing: the
// download URL, sha256 and size come from the release record `ship` wrote beside
// the `linux-tar-flatpak` archive, and a missing record stops the command. What
// goes where is the module header of `utils/ship/flatpark.ts` and ADR 0143.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Argv } from 'yargs';

import { Config } from '../config.js';
import type { Command } from '../types/index.js';
import { readPackageJson } from '../utils/pkg-json.js';
import { parseGithubRepo, readFlatparkSources, releaseDateOf, renderFlatparkPackage } from '../utils/ship/flatpark.js';
import { readStageManifest } from '../utils/ship/stage-manifest.js';

const LOG = '[gjsify flatpark]';

interface FlatparkOptions {
    project?: string;
    out: string;
    stage?: string;
    'release-dir'?: string;
    repo?: string;
    'tag-prefix': string;
}

type PackageJson = {
    repository?: string | { url?: string };
    gjsify?: { site?: { repository?: string } };
};

/** `--repo`, else the project's `repository`, else `gjsify.site.repository` of it or of an ancestor. */
function resolveRepo(flag: string | undefined, projectDir: string): string {
    const candidates: Array<[string, string | undefined]> = [];
    if (flag !== undefined) candidates.push(['--repo', flag]);
    let dir = projectDir;
    for (let depth = 0; depth < 5; depth++) {
        const pkg = readPackageJson(join(dir, 'package.json')) as PackageJson | null | undefined;
        if (pkg !== undefined && pkg !== null) {
            const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
            if (depth === 0) candidates.push([`${join(dir, 'package.json')} repository`, repository]);
            candidates.push([`${join(dir, 'package.json')} gjsify.site.repository`, pkg.gjsify?.site?.repository]);
        }
        if (dirname(dir) === dir) break;
        dir = dirname(dir);
    }
    for (const [source, value] of candidates) {
        if (value === undefined) continue;
        const repo = parseGithubRepo(value);
        if (repo === undefined) throw new Error(`${LOG} ${source} is "${value}", which is not a GitHub repository.`);
        return repo;
    }
    throw new Error(
        `${LOG} no GitHub repository to download from. Pass --repo owner/name, or set \`repository\` in ` +
            'package.json or `gjsify.site.repository`.',
    );
}

export const flatparkCommand: Command<unknown, FlatparkOptions> = {
    command: 'flatpark [project]',
    description: 'Write the FlatPark package directory (registry/<app-id>/) for a project that ran `gjsify ship`.',
    builder: (yargs: Argv) =>
        yargs
            .positional('project', {
                type: 'string',
                description: 'The project directory. Default: the current directory.',
            })
            .option('out', {
                type: 'string',
                demandOption: true,
                requiresArg: true,
                description: 'The package directory to write, e.g. `<flatpark>/registry/eu.example.App`.',
            })
            .option('stage', {
                type: 'string',
                requiresArg: true,
                description: 'A `gjsify ship --stage` directory. Default: `<out dir of ship>/stage` of the project.',
            })
            .option('release-dir', {
                type: 'string',
                requiresArg: true,
                description:
                    'The directory holding `<artifact>.gjsify-release.json`. Default: `out/` of the ship out dir.',
            })
            .option('repo', {
                type: 'string',
                requiresArg: true,
                description: 'GitHub `owner/name` the releases are published on. Default: read from the project.',
            })
            .option('tag-prefix', {
                type: 'string',
                default: 'v',
                description: 'What precedes the version in the release tag.',
            }),

    handler: async (args) => {
        const projectDir = resolve(args.project ?? process.cwd());
        const config = await new Config().forCommand(projectDir);
        const shipOut = resolve(projectDir, config.ship?.outDir ?? 'ship');
        const stageDir = resolve(projectDir, args.stage ?? join(shipOut, 'stage'));
        const releaseDir = resolve(projectDir, args['release-dir'] ?? join(shipOut, 'out'));
        const outDir = resolve(args.out);

        const manifest = readStageManifest(stageDir);
        const settings = manifest.settings;
        const staged = (path: string): string => {
            const file = join(stageDir, path);
            if (!existsSync(file)) {
                throw new Error(
                    `${LOG} the stage has no ${path}. A FlatPark package needs a desktop application: ` +
                        'stage it with `gjsify ship --stage` on a project of `kind: app`.',
                );
            }
            return file;
        };

        const repo = resolveRepo(args.repo, projectDir);
        const icon = pickIcon(stageDir, settings.appId);
        const sources = readFlatparkSources({
            dir: releaseDir,
            repo,
            version: settings.version,
            tagPrefix: args['tag-prefix'],
            stageArch: manifest.target.arch,
        });
        const files = renderFlatparkPackage({
            appId: settings.appId,
            name: settings.name,
            binaryName: settings.binaryName,
            summary: settings.summary,
            version: settings.version,
            ...(settings.homepage === undefined ? {} : { homepage: settings.homepage }),
            repo,
            flatpak: settings.flatpak,
            sources,
            desktopEntry: readFileSync(staged(`share/applications/${settings.appId}.desktop`), 'utf-8'),
            metainfo: readFileSync(staged(`share/metainfo/${settings.appId}.metainfo.xml`), 'utf-8'),
            icon,
            releaseDate: releaseDateOf(manifest.mtime),
        });

        mkdirSync(outDir, { recursive: true });
        for (const file of files) {
            writeFileSync(join(outDir, file.path), file.data, { mode: file.mode });
        }
        console.log(`${LOG} wrote ${files.length} file(s) for ${settings.appId} ${settings.version} to ${outDir}`);
        for (const source of sources) console.log(`${LOG}   ${source.arch}: ${source.url}`);
        console.log(
            `${LOG} next: ${relative(process.cwd(), join(outDir, 'flatpark.yml')) || 'flatpark.yml'} has ` +
                "`upstream_approved: false`; a row in FlatPark's docs/reference/upstream-approvals.md is the maintainer's.",
        );
    },
};

/** The 128 px raster when the stage has one, else the largest up to 512 px. FlatPark takes no bigger. */
function pickIcon(stageDir: string, appId: string): { bytes: Uint8Array; size: number } {
    const base = join(stageDir, 'share', 'icons', 'hicolor');
    const sizes = existsSync(base)
        ? readdirSync(base)
              .map((entry) => /^(\d+)x\1$/.exec(entry)?.[1])
              .filter((size): size is string => size !== undefined)
              .map(Number)
              .filter((size) => size <= 512 && existsSync(join(base, `${size}x${size}`, 'apps', `${appId}.png`)))
              .sort((a, b) => a - b)
        : [];
    const size = sizes.includes(128) ? 128 : sizes[sizes.length - 1];
    if (size === undefined) {
        throw new Error(
            `${LOG} the stage has no PNG icon for ${appId} up to 512 px under share/icons/hicolor/. FlatPark ` +
                'takes a PNG or an SVG, and an SVG can fail AppStream compose, so this command wants a raster.',
        );
    }
    return { bytes: readFileSync(join(base, `${size}x${size}`, 'apps', `${appId}.png`)), size };
}
