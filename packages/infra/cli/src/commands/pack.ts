// `gjsify pack [path] [--pack-destination <dir>] [--json]` — npm-compatible
// tarball creation for the workspace at `path` (default: cwd).
//
// Output shape matches `npm pack --json`:
//   [
//     {
//       "filename": "scope-name-1.2.3.tgz",
//       "name": "@scope/name",
//       "version": "1.2.3",
//       "size": <unpacked bytes>,
//       "unpackedSize": <unpacked bytes>,
//       "shasum": "<sha1 hex>",
//       "integrity": "sha512-<base64>",
//       "files": [ { path, size, mode }, ... ],
//       "entryCount": <int>
//     }
//   ]
//
// File selection mirrors npm pack: explicit `files` field if present, else
// the default allowlist (README/LICENSE/package.json + main entry + bin). The
// implementation here is conservative — when no `files` field is set we walk
// the workspace recursively and apply the implicit-exclusion set
// (.git, node_modules, …) plus .npmignore / .gitignore. workspace:^ deps in
// package.json are rewritten to resolved npm version ranges based on the
// sibling workspaces' own versions, so the published tarball is consumable.

import type { Command } from '../types/index.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createTarball, gzip, type TarWriteEntry } from '@gjsify/tar';
import { discoverWorkspaces } from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';

interface PackOptions {
    path?: string;
    'pack-destination'?: string;
    json?: boolean;
    'dry-run'?: boolean;
}

interface PackResult {
    filename: string;
    name: string;
    version: string;
    size: number;
    unpackedSize: number;
    shasum: string;
    integrity: string;
    entryCount: number;
    files: { path: string; size: number; mode: number }[];
    /** Absolute path of the written .tgz, or null on --dry-run. */
    absolutePath: string | null;
}

export const packCommand: Command<any, PackOptions> = {
    command: 'pack [path]',
    description: 'Produce an npm-compatible .tgz tarball for the workspace at <path> (default: cwd). Rewrites workspace:^/~/* deps to resolved versions.',
    builder: (yargs) =>
        yargs
            .positional('path', {
                description: 'Workspace path (default: cwd).',
                type: 'string',
            })
            .option('pack-destination', {
                description: 'Directory to write the tarball into. Default: workspace cwd.',
                type: 'string',
            })
            .option('json', {
                description: 'Emit pack metadata as JSON on stdout (mirrors `npm pack --json`).',
                type: 'boolean',
                default: false,
            })
            .option('dry-run', {
                description: 'Compute everything but do not write the .tgz.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const wsDir = resolve(args.path ?? process.cwd());
        const result = await packWorkspace(wsDir, {
            destination: args['pack-destination'],
            dryRun: args['dry-run'] === true,
        });
        if (args.json) {
            process.stdout.write(`${JSON.stringify([result], null, 2)}\n`);
        } else {
            process.stdout.write(`${result.filename}\n`);
        }
    },
};

export interface PackWorkspaceOptions {
    /** Directory to write the .tgz into. Defaults to the workspace itself. */
    destination?: string;
    /** Skip writing the .tgz; metadata is still computed (for npm-compat callers). */
    dryRun?: boolean;
    /** Skip the workspace:^ rewrite step (rare — useful for testing the raw layout). */
    skipWorkspaceRewrite?: boolean;
}

/**
 * Programmatic equivalent of the `pack` command — used by `gjsify publish`
 * to avoid spawning a subprocess. Caller is responsible for resolving
 * `wsDir` to an absolute path.
 */
export async function packWorkspace(wsDir: string, opts: PackWorkspaceOptions = {}): Promise<PackResult> {
    const pkgPath = join(wsDir, 'package.json');
    if (!existsSync(pkgPath)) {
        throw new Error(`gjsify pack: no package.json at ${wsDir}`);
    }
    const originalSource = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(originalSource) as Record<string, unknown>;
    const name = typeof pkg.name === 'string' ? pkg.name : '';
    const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    if (!name) {
        throw new Error(`gjsify pack: package.json at ${wsDir} has no "name"`);
    }

    // Rewrite workspace:^/~/* deps to resolved npm version ranges, mirroring
    // yarn's auto-rewrite at publish time. Done in-memory only — the source
    // package.json on disk is never mutated by `gjsify pack`.
    const rewrittenPkg = opts.skipWorkspaceRewrite
        ? pkg
        : rewriteWorkspaceDeps(pkg, wsDir);
    const rewrittenSource = JSON.stringify(rewrittenPkg, null, indentOf(originalSource)) + '\n';

    // Collect files according to the package.json `files` field (or npm's
    // default set). The package.json itself is always included with the
    // rewritten contents.
    const filesToPack = collectFiles(wsDir, pkg);
    const entries: TarWriteEntry[] = [{ name: 'package/', directory: true, mode: 0o755 }];
    const fileMetas: { path: string; size: number; mode: number }[] = [];
    let unpackedSize = 0;
    for (const rel of filesToPack) {
        let body: Uint8Array;
        if (rel === 'package.json') {
            body = new TextEncoder().encode(rewrittenSource);
        } else {
            body = new Uint8Array(readFileSync(join(wsDir, rel)));
        }
        const st = statSync(join(wsDir, rel));
        const mode = st.mode & 0o777;
        entries.push({ name: `package/${rel}`, body, mode, mtime: 0 });
        fileMetas.push({ path: rel, size: body.byteLength, mode });
        unpackedSize += body.byteLength;
    }

    const tarBytes = createTarball(entries);
    const gzipBytes = await gzip(tarBytes);

    // npm filename: scope replaced with leading dash. "@gjsify/foo" → "gjsify-foo".
    const filenameBase = name.startsWith('@')
        ? name.slice(1).replace('/', '-')
        : name;
    const filename = `${filenameBase}-${version}.tgz`;

    const sha1 = createHash('sha1').update(gzipBytes).digest('hex');
    const sha512 = createHash('sha512').update(gzipBytes).digest('base64');
    const integrity = `sha512-${sha512}`;

    const destDir = opts.destination ? resolve(opts.destination) : wsDir;
    const tarPath = join(destDir, filename);
    if (!opts.dryRun) {
        mkdirSync(destDir, { recursive: true });
        writeFileSync(tarPath, gzipBytes);
    }

    return {
        filename,
        name,
        version,
        size: gzipBytes.byteLength,
        unpackedSize,
        shasum: sha1,
        integrity,
        entryCount: fileMetas.length,
        files: fileMetas,
        absolutePath: opts.dryRun ? null : tarPath,
    };
}

/**
 * Walk the workspace and return the list of files to include in the tarball,
 * relative to `wsDir`. Mirrors npm pack's selection rules:
 *
 *   - If pkg.files exists: use it as an allowlist (with .npmignore as a
 *     blacklist within those globs)
 *   - Otherwise: walk everything, apply .npmignore + .gitignore, drop the
 *     implicit-exclusion set (node_modules, .git, …)
 *
 * package.json, README*, LICENSE*, NOTICE* and the `bin`/`main` files are
 * always force-included regardless of the rules above.
 */
function collectFiles(wsDir: string, pkg: Record<string, unknown>): string[] {
    const always = forceIncluded(pkg);
    const filesField = Array.isArray(pkg.files) ? (pkg.files as unknown[]).filter((f): f is string => typeof f === 'string') : null;

    let candidates: string[];
    if (filesField) {
        candidates = expandFilesPatterns(wsDir, filesField);
    } else {
        candidates = walkAll(wsDir);
    }

    const ignore = loadIgnore(wsDir);

    const out = new Set<string>();
    for (const f of candidates) {
        if (!ignore(f)) out.add(f);
    }
    for (const f of always) {
        if (existsSync(join(wsDir, f))) out.add(f);
    }
    return [...out].sort();
}

const ALWAYS_INCLUDED_BASENAMES = new Set(['package.json', 'README', 'README.md', 'LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md']);
const NEVER_INCLUDED_BASENAMES = new Set([
    '.git', '.svn', '.hg', '.gitignore', '.gitattributes', '.npmrc',
    'CVS', '.DS_Store', 'node_modules', '.npmignore', 'package-lock.json',
    'gjsify-lock.json', 'yarn.lock', 'yarn-error.log', '.yarn',
    '.pnp.cjs', '.pnp.loader.mjs', 'tsconfig.tsbuildinfo',
]);

function forceIncluded(pkg: Record<string, unknown>): string[] {
    const out = new Set<string>();
    out.add('package.json');
    for (const name of ['README', 'README.md', 'LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md']) {
        out.add(name);
    }
    const main = typeof pkg.main === 'string' ? pkg.main : null;
    if (main) out.add(main.replace(/^\.\//, ''));
    const bin = pkg.bin;
    if (typeof bin === 'string') {
        out.add(bin.replace(/^\.\//, ''));
    } else if (bin && typeof bin === 'object') {
        for (const v of Object.values(bin as Record<string, unknown>)) {
            if (typeof v === 'string') out.add(v.replace(/^\.\//, ''));
        }
    }
    return [...out];
}

function walkAll(root: string, sub: string = ''): string[] {
    const out: string[] = [];
    const here = sub ? join(root, sub) : root;
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(here, { withFileTypes: true }); } catch { return out; }
    for (const entry of entries) {
        if (NEVER_INCLUDED_BASENAMES.has(entry.name)) continue;
        if (entry.name.startsWith('.tsbuildinfo')) continue;
        const rel = sub ? `${sub}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...walkAll(root, rel));
        } else if (entry.isFile()) {
            out.push(rel);
        }
    }
    return out;
}

function expandFilesPatterns(wsDir: string, patterns: readonly string[]): string[] {
    const out = new Set<string>();
    for (const pattern of patterns) {
        // Drop leading ./
        const normalized = pattern.replace(/^\.\//, '').replace(/\/$/, '');
        const full = join(wsDir, normalized);
        if (!existsSync(full)) continue;
        const st = statSync(full);
        if (st.isDirectory()) {
            for (const f of walkAll(wsDir, normalized)) out.add(f);
        } else if (st.isFile()) {
            out.add(normalized);
        }
        // TODO: glob patterns (foo/*.js). Currently we treat the entry as a
        // literal file or directory. Most monorepos use file/dir entries only
        // (lib, dist, prebuilds) — globs are rare. Surface a warning if the
        // pattern contains glob chars and didn't resolve.
        if (!existsSync(full) && /[*?[]/.test(pattern)) {
            console.warn(`gjsify pack: files entry "${pattern}" looks like a glob but glob expansion isn't implemented — pass literal files/dirs`);
        }
    }
    return [...out];
}

function loadIgnore(wsDir: string): (rel: string) => boolean {
    // .npmignore takes precedence over .gitignore (npm semantics).
    const npmIgnorePath = join(wsDir, '.npmignore');
    const gitIgnorePath = join(wsDir, '.gitignore');
    const patterns: RegExp[] = [];
    const sourcePath = existsSync(npmIgnorePath) ? npmIgnorePath : (existsSync(gitIgnorePath) ? gitIgnorePath : null);
    if (sourcePath) {
        const lines = readFileSync(sourcePath, 'utf-8').split('\n');
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            // Simple translation: pattern → regex anchored to start, with `*` → `[^/]*`
            // and `**` → `.*`. Negations (`!`) are skipped.
            if (line.startsWith('!')) continue;
            patterns.push(globToRegex(line));
        }
    }
    return (rel: string): boolean => {
        for (const p of patterns) if (p.test(rel)) return true;
        return false;
    };
}

function globToRegex(glob: string): RegExp {
    // Strip leading / (anchors to root)
    let pat = glob.replace(/^\//, '');
    // Escape regex metachars except *,?,/
    pat = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // ** → .*  *  → [^/]*  ? → [^/]
    pat = pat.replace(/\*\*/g, '__DOUBLESTAR__').replace(/\*/g, '[^/]*').replace(/__DOUBLESTAR__/g, '.*');
    pat = pat.replace(/\?/g, '[^/]');
    return new RegExp(`^${pat}($|/)`);
}

/**
 * Walk pkg.dependencies / devDependencies / peerDependencies /
 * optionalDependencies and replace `workspace:^` / `workspace:~` /
 * `workspace:*` ranges with the resolved npm range based on each sibling
 * workspace's version field.
 */
function rewriteWorkspaceDeps(pkg: Record<string, unknown>, wsDir: string): Record<string, unknown> {
    const root = findWorkspaceRoot(wsDir);
    if (!root) return pkg;
    const siblings = new Map<string, string>();
    for (const ws of discoverWorkspaces(root)) {
        if (ws.name && ws.version) siblings.set(ws.name, ws.version);
    }
    const cloned = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
    for (const block of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = cloned[block] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [name, range] of Object.entries(deps)) {
            if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
            const wsVer = siblings.get(name);
            if (!wsVer) {
                throw new Error(`gjsify pack: ${cloned.name} declares workspace:^ on ${name} but no sibling workspace with that name exists in the monorepo at ${root}`);
            }
            const operator = range.slice('workspace:'.length);
            if (operator === '*' || operator === '') {
                deps[name] = wsVer;
            } else if (operator === '^' || operator === '~') {
                deps[name] = `${operator}${wsVer}`;
            } else {
                deps[name] = operator;
            }
        }
    }
    return cloned;
}

function indentOf(source: string): string {
    const m = source.match(/\n([ \t]+)"/);
    return m ? m[1]! : '  ';
}
