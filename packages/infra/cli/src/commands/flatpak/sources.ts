// `gjsify flatpak sources` — turn a lockfile into a flatpak-builder `sources`
// array so a Flathub build (which forbids network access) can vendor every npm
// tarball offline.
//
// Auto-detects the lockfile format — gjsify's own `gjsify-lock.json`, npm's
// `package-lock.json`, classic `yarn.lock`, or pnpm's `pnpm-lock.yaml` — so it
// is a Node-free, dependency-free replacement for the Python
// `flatpak-node-generator` that `gjsify flatpak deps` wraps (one tool, no pipx).
//
// Each locked tarball becomes a flatpak `file` source that downloads straight
// into gjsify's content-addressed tarball cache layout:
//
//   $XDG_CACHE_HOME/gjsify/tarballs/v1/<algo>/<hex[0:2]>/<full-hex>.tgz
//
// (the exact path `install-tarball-cache.ts` computes from the SRI integrity).
// flatpak-builder fetches them in its network-allowed download phase; the build
// itself then runs `gjsify install --immutable` fully offline, finding every
// tarball in the pre-populated cache.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import type { Command } from '../../types/index.js';

type LockfileType = 'gjsify' | 'npm' | 'yarn' | 'pnpm';

interface FlatpakSourcesOptions {
    lockfile?: string;
    type?: LockfileType;
    out?: string;
    cacheRoot?: string;
    printModule?: boolean;
}

/** One vendored tarball: its download URL + its SRI integrity (`sha512-…`). */
interface Tarball {
    url: string;
    integrity: string;
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

/** Parse an SRI integrity (`sha512-<base64>`) into `{ algorithm, hex }`. Mirrors
 *  `install-tarball-cache.ts` so the emitted cache paths match byte-for-byte. */
function parseSri(integrity: string | undefined): { algorithm: string; hex: string } | null {
    if (!integrity) return null;
    const dash = integrity.indexOf('-');
    if (dash <= 0 || dash === integrity.length - 1) return null;
    const algorithm = integrity.slice(0, dash);
    const b64 = integrity.slice(dash + 1).replace(/=+$/, '');
    // Base64 decoding is lenient on every runtime (Node skips invalid chars,
    // @gjsify/buffer's table decode maps them to 0): malformed input yields
    // short/garbage output — caught by the length check below — never a throw.
    const hex = Buffer.from(b64, 'base64').toString('hex');
    if (hex.length < 4) return null;
    return { algorithm, hex };
}

// --- lockfile parsers ------------------------------------------------------

interface LockEntryShape {
    resolved?: string;
    integrity?: string;
    dependencies?: Record<string, LockEntryShape>;
}

/** gjsify-lock.json + package-lock.json share npm's v2/v3 `packages` shape:
 *  a map keyed by install path, each with `resolved` + `integrity`. Falls back
 *  to npm's v1 nested `dependencies` tree. */
function parseNpmLike(json: unknown): Tarball[] {
    const out: Tarball[] = [];
    const root = json as { packages?: Record<string, LockEntryShape>; dependencies?: Record<string, LockEntryShape> };
    const packages = root.packages;
    if (packages && typeof packages === 'object') {
        for (const entry of Object.values(packages)) {
            if (entry?.resolved && entry.integrity) out.push({ url: entry.resolved, integrity: entry.integrity });
        }
        if (out.length > 0) return out;
    }
    // npm lockfileVersion 1: nested `dependencies` tree.
    if (root.dependencies && typeof root.dependencies === 'object') collectV1Deps(root.dependencies, out);
    return out;
}

function collectV1Deps(deps: Record<string, LockEntryShape>, out: Tarball[]): void {
    for (const node of Object.values(deps)) {
        if (node?.resolved && node.integrity) out.push({ url: node.resolved, integrity: node.integrity });
        if (node?.dependencies) collectV1Deps(node.dependencies, out);
    }
}

/** Classic (v1) `yarn.lock`: blank-line-separated blocks, each with a
 *  `resolved "<url>#<sha1>"` and (yarn ≥1.x) an `integrity sha512-…` line.
 *  Yarn Berry (v2+) is rejected — its `checksum` is a zip-cache hash, not a
 *  tarball SRI, so the tarball can't be verified from the lockfile. */
function parseYarnClassic(text: string): Tarball[] {
    if (/^__metadata:/m.test(text)) {
        throw new Error(
            'gjsify flatpak sources: Yarn Berry (v2+) yarn.lock is not supported — its `checksum` is ' +
                'a cache hash, not a tarball SRI. Run `gjsify install` to produce a gjsify-lock.json, ' +
                'or use a classic (v1) yarn.lock.',
        );
    }
    const out: Tarball[] = [];
    let noIntegrity = 0;
    for (const block of text.split(/\n\s*\n/)) {
        const rm = block.match(/^\s+resolved\s+"([^"]+)"/m);
        if (!rm) continue;
        const url = rm[1].replace(/#.*$/, ''); // strip the trailing #<sha1> fragment
        const im = block.match(/^\s+integrity\s+(\S+)/m);
        if (!im) {
            noIntegrity++;
            continue;
        }
        out.push({ url, integrity: im[1] });
    }
    if (noIntegrity > 0) {
        console.warn(
            `[gjsify flatpak sources] ${noIntegrity} yarn.lock entr(y/ies) had no integrity (pre-1.x format) ` +
                'and were skipped — re-lock with a modern yarn or use `gjsify install`.',
        );
    }
    return out;
}

/** pnpm-lock.yaml: each `packages:` entry's `resolution.integrity` is the
 *  tarball SRI; the URL is `resolution.tarball` or reconstructed from the key.
 *  Handles both v9 (`name@version`) and v5/6 (`/name/version`) key shapes.
 *
 *  A small targeted scanner instead of a full YAML parser: pnpm always writes
 *  the resolution inline (`resolution: {integrity: …}`), so this needs no extra
 *  dependency and stays bundle-light. It reads ONLY the top-level `packages:`
 *  block (not `snapshots:`/`importers:`), keys at exactly 2-space indent. */
function parsePnpm(text: string): Tarball[] {
    const out: Tarball[] = [];
    let inPackages = false;
    let currentKey: string | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (/^packages:\s*$/.test(line)) {
            inPackages = true;
            continue;
        }
        // A non-indented, non-comment line ends the `packages:` section.
        if (inPackages && /^[^\s#]/.test(line)) inPackages = false;
        if (!inPackages) continue;
        // Package key: exactly 2-space indent, quoted or bare, ending in ':'.
        const keyM = line.match(/^ {2}(?:'([^']+)'|"([^"]+)"|([^\s#][^:]*)):\s*$/);
        if (keyM) {
            currentKey = keyM[1] ?? keyM[2] ?? keyM[3] ?? null;
            continue;
        }
        // Inline resolution: `resolution: {integrity: sha…, tarball: …}`.
        const resM = line.match(/resolution:\s*\{([^}]*)\}/);
        if (resM && currentKey) {
            const intM = resM[1].match(/integrity:\s*(sha\d+-[A-Za-z0-9+/=]+)/);
            if (!intM) continue;
            const tarM = resM[1].match(/tarball:\s*([^\s,}]+)/);
            const url = tarM ? tarM[1] : reconstructNpmTarballUrl(currentKey);
            if (url) out.push({ url, integrity: intM[1] });
        }
    }
    return out;
}

/** Reconstruct the canonical npm tarball URL from a pnpm package key. Returns
 *  null for non-registry refs (aliases, git, …). */
function reconstructNpmTarballUrl(key: string): string | null {
    let name: string;
    let version: string;
    if (key.startsWith('/')) {
        // v5/6: /name/version or /@scope/name/version, optional `_peer` suffix.
        const k = key.slice(1).replace(/_.*$/, '');
        const idx = k.lastIndexOf('/');
        if (idx <= 0) return null;
        name = k.slice(0, idx);
        version = k.slice(idx + 1);
    } else {
        // v9: name@version, optional `(peer@x)` suffixes.
        const k = key.replace(/\(.*\)$/, '');
        const at = k.lastIndexOf('@');
        if (at <= 0) return null;
        name = k.slice(0, at);
        version = k.slice(at + 1);
    }
    // Only plain registry semver versions — skip aliases / protocols.
    if (!name || !version || /[@:/]/.test(version)) return null;
    const basename = name.slice(name.lastIndexOf('/') + 1);
    return `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
}

function detectType(file: string): LockfileType {
    const base = file.toLowerCase();
    if (base.endsWith('pnpm-lock.yaml')) return 'pnpm';
    if (base.endsWith('yarn.lock')) return 'yarn';
    if (base.endsWith('package-lock.json')) return 'npm';
    return 'gjsify';
}

function defaultLockfile(cwd: string): string {
    for (const f of ['gjsify-lock.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
        if (existsSync(join(cwd, f))) return f;
    }
    return 'gjsify-lock.json'; // surfaces a clear "not found" later
}

function parseLockfile(path: string, type: LockfileType): Tarball[] {
    const text = readFileSync(path, 'utf-8');
    if (type === 'yarn') return parseYarnClassic(text);
    if (type === 'pnpm') return parsePnpm(text);
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (err) {
        throw new Error(`gjsify flatpak sources: ${path} is not valid JSON: ${(err as Error).message}`);
    }
    return parseNpmLike(json);
}

// --- command ---------------------------------------------------------------

export const flatpakSourcesCommand: Command<unknown, FlatpakSourcesOptions> = {
    command: 'sources',
    description:
        'Generate an offline flatpak-builder `sources` array from any lockfile (gjsify-lock.json / package-lock.json / yarn.lock / pnpm-lock.yaml) for a no-network Flathub build.',
    builder: (yargs) => {
        return yargs
            .option('lockfile', {
                description:
                    'Path to the lockfile. Default: the first of gjsify-lock.json / package-lock.json / yarn.lock / pnpm-lock.yaml found in cwd.',
                type: 'string',
                normalize: true,
            })
            .option('type', {
                description: 'Lockfile format. Default: detected from the filename.',
                choices: ['gjsify', 'npm', 'yarn', 'pnpm'] as const,
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
        const lockfile = resolve(cwd, (args.lockfile as string | undefined) ?? defaultLockfile(cwd));
        if (!existsSync(lockfile)) {
            throw new Error(
                `gjsify flatpak sources: lockfile ${lockfile} not found. ` +
                    'Run `gjsify install` (or npm/yarn/pnpm) first, or pass --lockfile.',
            );
        }
        const type = (args.type as LockfileType | undefined) ?? detectType(lockfile);

        const tarballs = parseLockfile(lockfile, type);
        const cacheRoot = (args.cacheRoot as string | undefined) ?? 'flatpak-gjsify-cache';

        // Dedupe by content hash — the same tarball is locked at many install
        // paths; flatpak rejects duplicate dest/filename pairs.
        const byHex = new Map<string, FlatpakFileSource>();
        let skippedSri = 0;
        let skippedAlgo = 0;
        for (const { url, integrity } of tarballs) {
            const sri = parseSri(integrity);
            if (!sri) {
                skippedSri++;
                continue;
            }
            if (!FLATPAK_ALGOS.has(sri.algorithm)) {
                skippedAlgo++;
                continue;
            }
            const key = `${sri.algorithm}:${sri.hex}`;
            if (byHex.has(key)) continue;
            const source: FlatpakFileSource = {
                type: 'file',
                url,
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
            `[gjsify flatpak sources] wrote ${out} — ${sources.length} tarball source(s) from ${type} lockfile` +
                ` (${tarballs.length} locked entr${tarballs.length === 1 ? 'y' : 'ies'})` +
                (skippedSri ? `, ${skippedSri} without a usable integrity skipped` : '') +
                (skippedAlgo ? `, ${skippedAlgo} non-sha256/512 skipped` : ''),
        );

        if (args.printModule) {
            console.error(buildModuleSnippet(args.out ?? 'gjsify-sources.json', cacheRoot));
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
