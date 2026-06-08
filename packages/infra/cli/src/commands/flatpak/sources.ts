// `gjsify flatpak sources` — turn a `gjsify-lock.json` into a flatpak-builder
// `sources` array so a Flathub build (which forbids network access) can vendor
// every npm tarball offline.
//
// Unlike `gjsify flatpak deps` (which wraps the Python `flatpak-node-generator`
// for yarn.lock / package-lock.json), this reads gjsify's OWN lockfile and
// needs no external tool. Each locked tarball becomes a flatpak `file` source
// that downloads straight into gjsify's content-addressed tarball cache layout:
//
//   $XDG_CACHE_HOME/gjsify/tarballs/v1/<algo>/<hex[0:2]>/<full-hex>.tgz
//
// (the exact path `install-tarball-cache.ts` computes from the SRI integrity).
// flatpak-builder fetches them in its network-allowed download phase; the build
// itself then runs `gjsify install --immutable` fully offline, finding every
// tarball in the pre-populated cache.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import type { Command } from '../../types/index.js';

interface FlatpakSourcesOptions {
    lockfile?: string;
    out?: string;
    cacheRoot?: string;
    printModule?: boolean;
}

/** Checksum algorithms flatpak-builder accepts on a `file` source. */
const FLATPAK_ALGOS = new Set(['sha256', 'sha512']);

/** A minimal flatpak-builder `file` source object. */
interface FlatpakFileSource {
    type: 'file';
    url: string;
    dest: string;
    'dest-filename': string;
    sha256?: string;
    sha512?: string;
}

interface LockPackage {
    version?: string;
    resolved?: string;
    integrity?: string;
}

/** Parse an SRI integrity (`sha512-<base64>`) into `{ algorithm, hex }`. Mirrors
 *  `install-tarball-cache.ts` so the emitted cache paths match byte-for-byte. */
function parseSri(integrity: string | undefined): { algorithm: string; hex: string } | null {
    if (!integrity) return null;
    const dash = integrity.indexOf('-');
    if (dash <= 0 || dash === integrity.length - 1) return null;
    const algorithm = integrity.slice(0, dash);
    const b64 = integrity.slice(dash + 1).replace(/=+$/, '');
    let hex: string;
    try {
        hex = Buffer.from(b64, 'base64').toString('hex');
    } catch {
        return null;
    }
    if (hex.length < 4) return null;
    return { algorithm, hex };
}

export const flatpakSourcesCommand: Command<unknown, FlatpakSourcesOptions> = {
    command: 'sources',
    description:
        'Generate an offline flatpak-builder `sources` array from gjsify-lock.json (vendors every npm tarball for a no-network Flathub build).',
    builder: (yargs) => {
        return yargs
            .option('lockfile', {
                description: 'Path to the gjsify lockfile (default: gjsify-lock.json in cwd)',
                type: 'string',
                default: 'gjsify-lock.json',
                normalize: true,
            })
            .option('out', {
                description: 'Output JSON sources file',
                type: 'string',
                default: 'gjsify-sources.json',
                normalize: true,
            })
            .option('cache-root', {
                description:
                    'Relative dir the tarballs download into; point XDG_CACHE_HOME here in the build. ' +
                    'Tarballs land at <cache-root>/gjsify/tarballs/v1/<algo>/<shard>/<hex>.tgz.',
                type: 'string',
                default: 'flatpak-gjsify-cache',
            })
            .option('print-module', {
                description: 'Also print a ready-to-paste flatpak manifest module snippet to stderr',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const lockfile = resolve(cwd, (args.lockfile as string | undefined) ?? 'gjsify-lock.json');
        if (!existsSync(lockfile)) {
            throw new Error(
                `gjsify flatpak sources: lockfile ${lockfile} not found. ` +
                    'Run `gjsify install` first, or pass --lockfile.',
            );
        }

        let lock: { packages?: Record<string, LockPackage> };
        try {
            lock = JSON.parse(readFileSync(lockfile, 'utf-8'));
        } catch (err) {
            throw new Error(`gjsify flatpak sources: ${lockfile} is not valid JSON: ${(err as Error).message}`);
        }
        const packages = lock.packages ?? {};

        const cacheRoot = (args.cacheRoot as string | undefined) ?? 'flatpak-gjsify-cache';
        // Dedupe by content hash — the same tarball is locked at many install
        // paths; flatpak rejects duplicate dest/filename pairs.
        const byHex = new Map<string, FlatpakFileSource>();
        let skippedNoTarball = 0;
        let skippedAlgo = 0;
        for (const pkg of Object.values(packages)) {
            if (!pkg.resolved || !pkg.integrity) {
                // Local/workspace entries (no registry tarball) — nothing to vendor.
                skippedNoTarball++;
                continue;
            }
            const sri = parseSri(pkg.integrity);
            if (!sri) {
                skippedNoTarball++;
                continue;
            }
            if (!FLATPAK_ALGOS.has(sri.algorithm)) {
                // flatpak only verifies sha256/sha512.
                skippedAlgo++;
                continue;
            }
            const key = `${sri.algorithm}:${sri.hex}`;
            if (byHex.has(key)) continue;
            const source: FlatpakFileSource = {
                type: 'file',
                url: pkg.resolved,
                dest: `${cacheRoot}/gjsify/tarballs/v1/${sri.algorithm}/${sri.hex.slice(0, 2)}`,
                'dest-filename': `${sri.hex}.tgz`,
            };
            // FLATPAK_ALGOS gates this to exactly sha256 / sha512.
            if (sri.algorithm === 'sha512') source.sha512 = sri.hex;
            else source.sha256 = sri.hex;
            byHex.set(key, source);
        }

        // Stable order (by url) so the generated file diffs cleanly across runs.
        const sources = [...byHex.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

        const out = resolve(cwd, (args.out as string | undefined) ?? 'gjsify-sources.json');
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify(sources, null, 2) + '\n');

        console.log(
            `[gjsify flatpak sources] wrote ${out} — ${sources.length} tarball source(s)` +
                (skippedNoTarball ? `, ${skippedNoTarball} local/non-registry entr(y/ies) skipped` : '') +
                (skippedAlgo ? `, ${skippedAlgo} non-sha256/512 skipped` : ''),
        );

        if (args.printModule) {
            const snippet = buildModuleSnippet(args.out ?? 'gjsify-sources.json', cacheRoot);
            console.error(snippet);
        }
    },
};

/** A copy-pasteable flatpak manifest module that consumes the generated
 *  sources file and runs a fully offline `gjsify install`. */
function buildModuleSnippet(sourcesFile: string, cacheRoot: string): string {
    return [
        '',
        '# Add the generated sources to your app module and point XDG_CACHE_HOME',
        '# at the vendored cache before running gjsify offline. Example module:',
        '#',
        '#   {',
        '#     "name": "my-app",',
        '#     "buildsystem": "simple",',
        '#     "build-commands": [',
        `#       "export XDG_CACHE_HOME=\\"$(pwd)/${cacheRoot}\\"",`,
        '#       "gjsify install --immutable",',
        '#       "gjsify build src/main.ts --app gjs --outfile /app/bin/my-app"',
        '#     ],',
        '#     "sources": [',
        '#       { "type": "dir", "path": "." },',
        `#       "${sourcesFile}"`,
        '#     ]',
        '#   }',
        '',
    ].join('\n');
}
