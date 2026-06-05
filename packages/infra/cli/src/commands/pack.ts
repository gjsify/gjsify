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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createTarball, gzip, type TarWriteEntry } from '@gjsify/tar';
import { discoverWorkspaces } from '@gjsify/workspace';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import { runLifecycleScript } from '../utils/run-lifecycle-script.js';

interface PackOptions {
    path?: string;
    'pack-destination'?: string;
    json?: boolean;
    'dry-run'?: boolean;
    'ignore-scripts'?: boolean;
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

export const packCommand: Command<unknown, PackOptions> = {
    command: 'pack [path]',
    description:
        'Produce an npm-compatible .tgz tarball for the workspace at <path> (default: cwd). Rewrites workspace:^/~/* deps to resolved versions.',
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
            })
            .option('ignore-scripts', {
                description:
                    'Skip the `prepack` lifecycle script before packing. ' +
                    'Mirrors `npm pack --ignore-scripts`. Use when scripts ' +
                    'are already run by the outer workflow.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const wsDir = resolve(args.path ?? process.cwd());
        const result = await packWorkspace(wsDir, {
            destination: args['pack-destination'],
            dryRun: args['dry-run'] === true,
            lifecycleScripts: args['ignore-scripts'] ? [] : ['prepack'],
            // When emitting machine-readable JSON on stdout, the prepack
            // script's chatty log lines must NOT land on the parent's
            // stdout — `JSON.parse(stdout)` callers would otherwise fail
            // with `Unexpected token …`. Route lifecycle output to stderr.
            lifecycleStdio: args.json ? 'inherit-stderr' : 'inherit',
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
    /**
     * Lifecycle scripts to run from `pkg.scripts` BEFORE the file collection
     * pass. Order matters — entries are executed sequentially, stopping on
     * the first failure.
     *
     * Defaults:
     *   - `['prepack']` from the `gjsify pack` CLI handler
     *   - `['prepublishOnly', 'prepack']` from `gjsify publish`
     *   - `[]` from programmatic callers that have already run scripts
     *
     * Mirrors `npm pack` / `npm publish` semantics. Pass `[]` (or set
     * `--ignore-scripts` on the CLI) to skip — useful when an outer
     * workflow has already produced the build artifacts.
     */
    lifecycleScripts?: readonly string[];
    /**
     * Stdio mode for lifecycle scripts. Default `'inherit'` — child output
     * appears in the parent's terminal. Pass `'inherit-stderr'` to redirect
     * the child's stdout → parent's stderr; used by `gjsify pack --json`
     * and `gjsify publish` so the parent's stdout stays a clean
     * machine-readable JSON stream.
     */
    lifecycleStdio?: 'inherit' | 'inherit-stderr' | 'pipe' | 'ignore';
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

    // Run npm-style lifecycle scripts BEFORE walking the file tree. The
    // canonical case is `prepack` — many packages use it to generate
    // build artifacts that aren't otherwise produced by their `build`
    // script (template processing, codegen, etc.). Skipping these means
    // the resulting tarball is missing files the package needs to work
    // post-install. Matches `npm pack` / `npm publish` semantics.
    const lifecycleScripts = opts.lifecycleScripts ?? ['prepack'];
    for (const scriptName of lifecycleScripts) {
        await runLifecycleScript(wsDir, pkg, scriptName, {
            optional: true,
            stdio: opts.lifecycleStdio,
        });
    }

    // Re-read package.json AFTER lifecycle scripts in case one of them
    // mutated it (e.g. a `prepack` that injects build metadata into
    // package.json fields). Rare but legal — npm pack does the same.
    const sourceAfterScripts = readFileSync(pkgPath, 'utf-8');
    const pkgAfterScripts =
        sourceAfterScripts === originalSource ? pkg : (JSON.parse(sourceAfterScripts) as Record<string, unknown>);

    // Rewrite workspace:^/~/* deps to resolved npm version ranges, mirroring
    // yarn's auto-rewrite at publish time. Done in-memory only — the source
    // package.json on disk is never mutated by `gjsify pack`.
    const rewrittenPkg = opts.skipWorkspaceRewrite ? pkgAfterScripts : rewriteWorkspaceDeps(pkgAfterScripts, wsDir);
    const rewrittenSource = JSON.stringify(rewrittenPkg, null, indentOf(sourceAfterScripts)) + '\n';

    // Collect files according to the package.json `files` field (or npm's
    // default set). The package.json itself is always included with the
    // rewritten contents. We use the post-script `pkgAfterScripts` here so
    // that any `files` array modified by a prepack script is honored.
    const filesToPack = collectFiles(wsDir, pkgAfterScripts);
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
    const filenameBase = name.startsWith('@') ? name.slice(1).replace('/', '-') : name;
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
    const filesField = Array.isArray(pkg.files)
        ? (pkg.files as unknown[]).filter((f): f is string => typeof f === 'string')
        : null;

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

const NEVER_INCLUDED_BASENAMES = new Set([
    '.git',
    '.svn',
    '.hg',
    '.gitignore',
    '.gitattributes',
    '.npmrc',
    'CVS',
    '.DS_Store',
    'node_modules',
    '.npmignore',
    'package-lock.json',
    'gjsify-lock.json',
    'yarn.lock',
    'yarn-error.log',
    '.yarn',
    '.pnp.cjs',
    '.pnp.loader.mjs',
    'tsconfig.tsbuildinfo',
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
    let entries: Dirent[];
    try {
        entries = readdirSync(here, { withFileTypes: true });
    } catch {
        return out;
    }
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
    let allFiles: string[] | null = null;
    for (const pattern of patterns) {
        // Drop leading ./ and trailing /
        const normalized = pattern.replace(/^\.\//, '').replace(/\/$/, '');
        if (!normalized) continue;

        // Literal file or directory (the common case: lib, dist, prebuilds).
        if (!/[*?[\]]/.test(normalized)) {
            const full = join(wsDir, normalized);
            if (!existsSync(full)) continue;
            const st = statSync(full);
            if (st.isDirectory()) {
                for (const f of walkAll(wsDir, normalized)) out.add(f);
            } else if (st.isFile()) {
                out.add(normalized);
            }
            continue;
        }

        // Glob pattern (e.g. `lib/lib*.d.ts`, `dist/*.js`). Match every file in
        // the tree against the pattern AND against `<pattern>/**` (npm semantics:
        // a glob that resolves to a directory includes everything under it). `*`
        // does not cross `/`; `**` does. This is what npm-packlist does — without
        // it, `@gjsify/tsc`'s `files: ["lib/lib*.d.ts"]` shipped ZERO libs.
        allFiles ??= walkAll(wsDir);
        const fileRe = filesGlobToRegExp(normalized);
        const dirRe = filesGlobToRegExp(`${normalized}/**`);
        for (const f of allFiles) {
            if (fileRe.test(f) || dirRe.test(f)) out.add(f);
        }
    }
    return [...out];
}

/**
 * Translate an npm-`files`-style glob to an anchored RegExp. `*` matches any run
 * of non-`/` chars, `**` matches across `/`, `?` one non-`/` char, `[…]` a class.
 * All other regex metacharacters are escaped. Mirrors the subset of glob syntax
 * npm-packlist accepts in the `files` field.
 */
function filesGlobToRegExp(glob: string): RegExp {
    let re = '^';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                re += '.*';
                i++;
                if (glob[i + 1] === '/') i++; // consume the `/` after `**`
            } else {
                re += '[^/]*';
            }
        } else if (c === '?') {
            re += '[^/]';
        } else if (c === '[') {
            let j = i + 1;
            let cls = '[';
            if (glob[j] === '!') {
                cls += '^';
                j++;
            }
            for (; j < glob.length && glob[j] !== ']'; j++) cls += glob[j];
            if (j < glob.length) {
                re += `${cls}]`;
                i = j;
            } else {
                re += '\\['; // unmatched `[` → literal
            }
        } else if ('.+^${}()|\\]'.includes(c)) {
            re += `\\${c}`;
        } else {
            re += c;
        }
    }
    return new RegExp(`${re}$`);
}

function loadIgnore(wsDir: string): (rel: string) => boolean {
    // .npmignore takes precedence over .gitignore (npm semantics).
    const npmIgnorePath = join(wsDir, '.npmignore');
    const gitIgnorePath = join(wsDir, '.gitignore');
    const patterns: RegExp[] = [];
    const sourcePath = existsSync(npmIgnorePath) ? npmIgnorePath : existsSync(gitIgnorePath) ? gitIgnorePath : null;
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
    pat = pat
        .replace(/\*\*/g, '__DOUBLESTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__DOUBLESTAR__/g, '.*');
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
                throw new Error(
                    `gjsify pack: ${cloned.name} declares workspace:^ on ${name} but no sibling workspace with that name exists in the monorepo at ${root}`,
                );
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
