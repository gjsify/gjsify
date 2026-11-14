// `gjsify flatpark` — the FlatPark package directory (ADR 0143).
//
// FlatPark (https://github.com/flatpark/flatpark) builds `extra-data` Flatpaks from
// an upstream tarball: a `registry/<app-id>/` directory of a manifest, a hook that
// unpacks the download, a few install files and a descriptor. This module renders
// that directory from what `gjsify ship` already produced — the stage's desktop
// entry, metainfo and icon, the stage manifest's settings, and the release record
// beside the tarball — and WRITES NOTHING ELSE: no network, no hashing, no clock.
//
// Two rules the rendering is shaped by, both measured in the Phase-0 spike:
//
//   * `apply_extra.sh` never names a version. The tarball's top directory is
//     `<bin>-<version>-linux-<arch>`, so a hook that hard-codes it breaks on the
//     first update that FlatPark's resolver pins. The hook finds the one top-level
//     directory and refuses anything else; the only path it asserts is
//     `bin/<binaryName>`, which is stable.
//   * The same inputs give the same bytes. Nothing here reads a path, a hostname
//     or the time: the release date is the stage's build stamp (`mtime`), which is
//     the one stamp every other file of that stage already shares.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RELEASE_RECORD_SUFFIX, type ReleaseRecord } from './release-record.js';
import type { ShipFlatpakSettings } from './types.js';
import { xmlEscape } from './xml.js';

/** The extra-data file name inside the Flatpak. Fixed: the hook and the resolver both name it. */
export const FLATPARK_EXTRA_FILE = 'app.tar.gz';

/** The only format whose archive is meant as an `extra-data` source (ADR 0142). */
export const FLATPARK_RECORD_FORMAT = 'linux-tar-flatpak';

/** `process.arch` spelling → Flatpak arch. */
const FLATPAK_ARCH: Record<string, string> = { x64: 'x86_64', arm64: 'aarch64' };

export interface FlatparkSource {
    /** Flatpak spelling: `x86_64` or `aarch64`. */
    arch: string;
    /** Release asset name — the record's `artifact`. */
    artifact: string;
    url: string;
    sha256: string;
    size: number;
}

export interface FlatparkInputs {
    appId: string;
    name: string;
    binaryName: string;
    summary: string;
    version: string;
    homepage?: string;
    /** `owner/name` of the GitHub repository the releases are published on. */
    repo: string;
    flatpak: Pick<ShipFlatpakSettings, 'runtime' | 'runtimeVersion' | 'sdk' | 'finishArgs'>;
    /** Sorted by arch by the caller of {@link readFlatparkSources}; rendered in the order given. */
    sources: readonly FlatparkSource[];
    /** The stage's own, as `gjsify ship` rendered it. */
    desktopEntry: string;
    metainfo: string;
    icon: { bytes: Uint8Array; size: number };
    /** `YYYY-MM-DD`, UTC. */
    releaseDate: string;
}

export interface FlatparkFile {
    /** Relative to the package directory. */
    path: string;
    mode: number;
    data: string | Uint8Array;
}

/** `owner/name` out of `owner/name`, a github.com URL, or a `git+https://….git` URL. */
export function parseGithubRepo(value: string): string | undefined {
    const trimmed = value.trim().replace(/^git\+/, '');
    const bare = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
    const url = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
        trimmed,
    );
    const hit = url ?? bare;
    return hit === null ? undefined : `${hit[1]}/${hit[2]!.replace(/\.git$/, '')}`;
}

/** The UTC calendar date of a build stamp (seconds since the epoch). */
export function releaseDateOf(mtime: number): string {
    return new Date(mtime * 1000).toISOString().slice(0, 10);
}

/**
 * The release records beside the artifacts in `dir`, as FlatPark sources.
 *
 * The URL is the only thing derived here and it is derived from the repository
 * and the version, never fetched; `sha256` and `size` are the record's, which
 * `gjsify ship` took from the bytes it wrote. A missing record is an error and
 * not a reason to hash the file ourselves: a hash this command computed would
 * describe whatever is on this disk, not what was published.
 */
export function readFlatparkSources(input: {
    dir: string;
    repo: string;
    version: string;
    tagPrefix: string;
    /**
     * The arch the stage was assembled for. A pure-script payload records `noarch`, but its archive
     * name still carries one label and a FlatPark source needs an arch to pin — the stage's.
     */
    stageArch?: string;
}): FlatparkSource[] {
    const records: ReleaseRecord[] = [];
    if (existsSync(input.dir)) {
        for (const file of readdirSync(input.dir).sort()) {
            if (!file.endsWith(RELEASE_RECORD_SUFFIX)) continue;
            const record = JSON.parse(readFileSync(join(input.dir, file), 'utf-8')) as ReleaseRecord;
            if (record.format === FLATPARK_RECORD_FORMAT && record.os === 'linux') records.push(record);
        }
    }
    if (records.length === 0) {
        throw new Error(
            `gjsify flatpark: no release record for \`${FLATPARK_RECORD_FORMAT}\` in ${input.dir}. The URL, sha256 ` +
                `and size come from \`<artifact>${RELEASE_RECORD_SUFFIX}\`, which \`gjsify ship --target ` +
                `${FLATPARK_RECORD_FORMAT}\` writes beside the archive. Run that first, or point --release-dir at ` +
                'the directory that holds the record.',
        );
    }
    const tag = `${input.tagPrefix}${input.version}`;
    const sources = records.map((record): FlatparkSource => {
        const arch = FLATPAK_ARCH[record.arch === 'noarch' ? (input.stageArch ?? record.arch) : record.arch];
        if (arch === undefined) {
            throw new Error(
                `gjsify flatpark: ${record.artifact} is built for \`${record.arch}\`, which has no Flatpak arch ` +
                    `(known: ${Object.keys(FLATPAK_ARCH).join(', ')}).`,
            );
        }
        return {
            arch,
            artifact: record.artifact,
            url: `https://github.com/${input.repo}/releases/download/${tag}/${record.artifact}`,
            sha256: record.sha256,
            size: record.size,
        };
    });
    const seen = new Set<string>();
    for (const source of sources) {
        if (seen.has(source.arch)) {
            throw new Error(`gjsify flatpark: two release records for ${source.arch} in ${input.dir}; keep one.`);
        }
        seen.add(source.arch);
    }
    return sources.sort((a, b) => a.arch.localeCompare(b.arch));
}

/** The unpack hook. No version anywhere; the one asserted path derives from `binaryName`. */
export function renderApplyExtra(binaryName: string): string {
    return `#!/bin/sh
set -eu

extra_root="\${EXTRA_ROOT:-/app/extra}"
cd "$extra_root"

[ -f ${FLATPARK_EXTRA_FILE} ] || { echo "missing extra-data: ${FLATPARK_EXTRA_FILE}" >&2; exit 1; }

rm -rf stage app
mkdir stage
bsdtar --no-same-owner -xf ${FLATPARK_EXTRA_FILE} -C stage

top="$(find stage -mindepth 1 -maxdepth 1 -type d)"
[ "$(printf '%s\\n' "$top" | wc -l)" -eq 1 ] || { echo "expected one top-level directory" >&2; exit 1; }
mv "$top" app
[ -x app/bin/${shellWord(binaryName)} ] || { echo "${shellWord(binaryName)} launcher not found in the tarball" >&2; exit 1; }

rm -rf stage ${FLATPARK_EXTRA_FILE}
`;
}

export function renderWrapper(binaryName: string): string {
    return `#!/bin/sh
set -eu
exec /app/extra/app/bin/${shellWord(binaryName)} "$@"
`;
}

/** A binary name is a package name; anything outside this set would need quoting we do not do. */
function shellWord(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value)) {
        throw new Error(`gjsify flatpark: binary name "${value}" is not a plain file name.`);
    }
    return value;
}

/** A YAML scalar: plain when that reads back as the same string, JSON-quoted otherwise. */
function yamlString(value: string): string {
    const plain =
        /^[A-Za-z0-9_./@+=-][A-Za-z0-9_./@+=: -]*$/.test(value) &&
        !/^(?:true|false|null|yes|no|on|off|~)$/i.test(value) &&
        !/^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value) &&
        !/: |:$| $|^- /.test(value) &&
        !/^0[xo]/i.test(value);
    return plain ? value : JSON.stringify(value);
}

/**
 * The Flatpak manifest. The `extra-data` sources sit between marker comments
 * because FlatPark's updater rewrites exactly that block on every release.
 */
export function renderManifest(input: FlatparkInputs): string {
    const { appId, binaryName } = input;
    const files = [
        'apply_extra.sh',
        `${binaryName}-wrapper`,
        `${appId}.desktop`,
        `${appId}.metainfo.xml`,
        `${appId}.png`,
    ];
    const lines = [
        `id: ${yamlString(appId)}`,
        `runtime: ${yamlString(input.flatpak.runtime)}`,
        `runtime-version: ${JSON.stringify(input.flatpak.runtimeVersion)}`,
        `sdk: ${yamlString(input.flatpak.sdk)}`,
        `command: ${yamlString(binaryName)}`,
        'separate-locales: false',
        'build-options:',
        '  no-debuginfo: true',
        'finish-args:',
        ...input.flatpak.finishArgs.map((arg) => `  - ${yamlString(arg)}`),
        'modules:',
        `  - name: ${yamlString(binaryName)}`,
        '    buildsystem: simple',
        '    build-commands:',
        '      - install -Dm755 apply_extra.sh /app/bin/apply_extra',
        `      - install -Dm755 ${binaryName}-wrapper /app/bin/${binaryName}`,
        `      - install -Dm644 ${appId}.desktop /app/share/applications/${appId}.desktop`,
        `      - install -Dm644 ${appId}.metainfo.xml /app/share/metainfo/${appId}.metainfo.xml`,
        `      - install -Dm644 ${appId}.png /app/share/icons/hicolor/${input.icon.size}x${input.icon.size}/apps/${appId}.png`,
        '    sources:',
        '      # BEGIN MANAGED EXTRA-DATA',
        ...input.sources.flatMap((source) => [
            '      - type: extra-data',
            `        filename: ${FLATPARK_EXTRA_FILE}`,
            '        only-arches:',
            `          - ${source.arch}`,
            `        url: ${yamlString(source.url)}`,
            `        sha256: ${source.sha256}`,
            `        size: ${source.size}`,
        ]),
        '      # END MANAGED EXTRA-DATA',
        ...files.flatMap((path) => ['      - type: file', `        path: ${yamlString(path)}`]),
    ];
    return `${lines.join('\n')}\n`;
}

/** The first `<category>` of the metainfo — FlatPark's catalogue takes one. */
function firstCategory(metainfo: string): string {
    return /<category>([^<]+)<\/category>/.exec(metainfo)?.[1]?.trim() ?? 'Utility';
}

function keywords(metainfo: string): string[] {
    return [...metainfo.matchAll(/<keyword>([^<]+)<\/keyword>/g)].map((hit) => hit[1]!.trim());
}

export function renderDescriptor(input: FlatparkInputs): string {
    const tags = keywords(input.metainfo);
    const lines = [
        `id: ${yamlString(input.appId)}`,
        `name: ${yamlString(input.name)}`,
        `summary: ${yamlString(input.summary)}`,
        `website: ${yamlString(input.homepage ?? `https://github.com/${input.repo}`)}`,
        `source_url: https://github.com/${input.repo}`,
        'build:',
        `  manifest: ${input.appId}.yml`,
        '  branch: stable',
        '  mode: extra-data',
        `  arches: [${input.sources.map((source) => source.arch).join(', ')}]`,
        'catalog:',
        `  category: ${yamlString(firstCategory(input.metainfo))}`,
        // The row in FlatPark's `upstream-approvals.md` is the maintainer's to add.
        '  upstream_approved: false',
        ...(tags.length === 0 ? [] : ['  tags:', ...tags.map((tag) => `    - ${yamlString(tag)}`)]),
        'update:',
        '  command: ./resolve-update.sh',
        'policy:',
        '  proprietary: false',
        '  dangerous_permissions: []',
    ];
    return `${lines.join('\n')}\n`;
}

/** `jq`'s regex (Oniguruma), for the asset name of one arch with the version abstracted. */
function assetPattern(source: FlatparkSource, version: string): string {
    const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = source.artifact.indexOf(version);
    if (at < 0) {
        throw new Error(`gjsify flatpark: ${source.artifact} does not contain the version ${version}.`);
    }
    return `^${escaped(source.artifact.slice(0, at))}[0-9][0-9A-Za-z.+~-]*${escaped(source.artifact.slice(at + version.length))}$`;
}

export function renderResolveUpdate(input: FlatparkInputs): string {
    const sourceVars = input.sources.map((source) => {
        const key = source.arch.replace(/[^a-z0-9]/g, '_');
        return { source, key, pattern: assetPattern(source, input.version).replace(/\\/g, '\\\\') };
    });
    const lookups = sourceVars.map(
        ({ key, pattern }) =>
            `url_${key}="$(jq -r '.assets[] | select(.name | test("${pattern}")) | .browser_download_url' <<<"$rel" | head -n1)"\n` +
            `[ -n "$url_${key}" ] || { echo "no ${key} asset in this release" >&2; exit 1; }`,
    );
    const sources = sourceVars.map(
        ({ source, key }) => `{filename:"${FLATPARK_EXTRA_FILE}", arch:"${source.arch}", url:$u_${key}}`,
    );
    const args = sourceVars.map(({ key }) => `--arg u_${key} "$url_${key}"`);
    return `#!/usr/bin/env bash
# Update resolver for ${input.name}, written by \`gjsify flatpark\`.
#
# Prints the latest release on stdout as JSON:
#   { "version": "…", "releaseDate": "YYYY-MM-DD",
#     "sources": [ { "filename": "${FLATPARK_EXTRA_FILE}", "arch": "…", "url": "…" } ] }
# Logs go to stderr. No hashing and no manifest rewriting: FlatPark downloads
# each URL and computes the extra-data sha256 and size itself.
set -euo pipefail

repo="${input.repo}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 1; }; }
need curl; need jq

rel="$(curl -fsSL \${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \\
        "https://api.github.com/repos/$repo/releases/latest")"

version="$(jq -r '.tag_name | ltrimstr("v")' <<<"$rel")"
date="$(jq -r '.published_at' <<<"$rel" | cut -c1-10)"
[ -n "$version" ] && [ "$version" != "null" ] || { echo "failed to resolve the latest release of $repo" >&2; exit 1; }

${lookups.join('\n')}
echo "resolved ${input.name} $version ($date)" >&2

jq -n --arg v "$version" --arg d "$date" ${args.join(' ')} \\
  '{version:$v, releaseDate:$d, sources:[${sources.join(', ')}]}'
`;
}

/**
 * The metainfo with a `<releases>` block carrying this version, unless it has
 * one. FlatPark compares the resolver's version against the newest `<release>`
 * here, and Flatpak ignores an undated one — so a package starts with exactly one.
 */
export function withRelease(metainfo: string, version: string, date: string): string {
    if (/<releases[\s>]/.test(metainfo)) return metainfo;
    const block = `  <releases>\n    <release version="${xmlEscape(version)}" date="${date}" />\n  </releases>\n`;
    const close = metainfo.lastIndexOf('</component>');
    if (close < 0) throw new Error('gjsify flatpark: the staged metainfo has no </component>.');
    return `${metainfo.slice(0, close)}${block}${metainfo.slice(close)}`;
}

/** Every file of the package directory, in a fixed order. */
export function renderFlatparkPackage(input: FlatparkInputs): FlatparkFile[] {
    const { appId, binaryName } = input;
    if (input.sources.length === 0) throw new Error('gjsify flatpark: no sources to pin.');
    return [
        { path: `${appId}.yml`, mode: 0o644, data: renderManifest(input) },
        { path: 'apply_extra.sh', mode: 0o755, data: renderApplyExtra(binaryName) },
        { path: `${binaryName}-wrapper`, mode: 0o755, data: renderWrapper(binaryName) },
        { path: `${appId}.desktop`, mode: 0o644, data: input.desktopEntry },
        {
            path: `${appId}.metainfo.xml`,
            mode: 0o644,
            data: withRelease(input.metainfo, input.version, input.releaseDate),
        },
        { path: `${appId}.png`, mode: 0o644, data: input.icon.bytes },
        { path: 'flatpark.yml', mode: 0o644, data: renderDescriptor(input) },
        { path: 'resolve-update.sh', mode: 0o755, data: renderResolveUpdate(input) },
    ];
}
