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
import { readPackageJson } from '../utils/pkg-json.js';
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

    // Guard against the #655 class of bug: a `types`/`typings` declaration that
    // physically exists in the workspace but is excluded from the tarball by the
    // `files` allowlist. A mass-added `files: ["lib"]` (Phase D.7d, #179) silently
    // stripped `@gjsify/vite-plugin-blueprint`'s `types/blueprint.d.ts` and
    // `@gjsify/adwaita-fonts`' `index.d.ts` — the runtime entry still shipped, so
    // the break was invisible until a TypeScript consumer hit TS2307 / implicit
    // any. Enforce it at the exact point of packing so it can never recur.
    assertTypeDeclarationsShipped(wsDir, pkgAfterScripts, filesToPack);

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
 *   - If pkg.files exists: the array is an ALLOWLIST that overrides
 *     .gitignore / .npmignore entirely. Every file under an allowlisted
 *     path/dir ships from disk; only the hardcoded implicit-exclusion set
 *     (node_modules, .git, lockfiles, … — applied by `walkAll` /
 *     `expandFilesPatterns`) and npm's always-ignore names are dropped.
 *     This matches `npm pack`: a `files` entry re-includes a path even when
 *     .gitignore/.npmignore would drop it (verified against `npm pack
 *     --dry-run`). Trimming `files`-allowlisted content by .gitignore
 *     silently dropped build-generated-but-allowlisted files like
 *     adwaita-web's `src/styles.generated.ts` (gitignored, allowlisted via
 *     `files: ["src"]`) — shipping a broken tarball whose `src/index.ts`
 *     imported a file the tarball didn't contain.
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

    const out = new Set<string>();
    if (filesField) {
        // A `files` allowlist overrides .gitignore/.npmignore — ship every
        // allowlisted path from disk. `expandFilesPatterns` already excludes
        // the NEVER_INCLUDED_BASENAMES set (node_modules, .git, lockfiles, …)
        // via `walkAll`, so junk is still kept out.
        for (const f of expandFilesPatterns(wsDir, filesField)) out.add(f);
    } else {
        // No `files` field — walk everything and apply .npmignore/.gitignore.
        const ignore = loadIgnore(wsDir);
        for (const f of walkAll(wsDir)) {
            if (!ignore(f)) out.add(f);
        }
    }
    for (const f of always) {
        if (existsSync(join(wsDir, f))) out.add(f);
    }
    return [...out].sort();
}

/**
 * Collect every `types`/`typings` path a consumer's TypeScript would resolve for
 * this package: the top-level `types`/`typings` fields plus every value under a
 * `"types"` / `"typings"` CONDITION key anywhere in the `exports` tree. Values
 * are returned normalized (leading `./` stripped). Wildcard subpath patterns
 * (`./types/*`) are skipped — they can't be checked against concrete files.
 *
 * A subpath KEY named `./types` (as in `@gjsify/vite-plugin-blueprint`) is a
 * subpath, not a condition — it's walked, and the `types` condition INSIDE it is
 * what gets collected. Per Node's `exports` semantics a bare `types` key (no `.`
 * prefix) is a condition, so treating it as one here is correct.
 */
export function collectTypeDeclarationRefs(pkg: Record<string, unknown>): string[] {
    const out = new Set<string>();
    const add = (v: unknown): void => {
        if (typeof v !== 'string') return;
        const normalized = v.replace(/^\.\//, '');
        if (normalized.includes('*')) return;
        out.add(normalized);
    };
    for (const field of ['types', 'typings']) add(pkg[field]);
    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const e of node) walk(e);
            return;
        }
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (k === 'types' || k === 'typings') add(v);
            else walk(v);
        }
    };
    walk(pkg.exports);
    return [...out];
}

/**
 * Fail the pack if any `types`/`typings` declaration that physically exists in
 * the workspace is excluded from the tarball. There is NO legitimate reason to
 * reference a type file you don't ship — a consumer installing the package gets
 * silently broken type resolution while the runtime entry keeps working.
 *
 * Deliberately only fires for a file that is PRESENT on disk yet absent from the
 * packed set — the exact, unambiguous #655 mismatch. A `types` path that isn't
 * built yet (absent on disk) is left to `tsc`/the build to catch, so an unbuilt
 * dev tree doesn't produce a false positive.
 */
function assertTypeDeclarationsShipped(
    wsDir: string,
    pkg: Record<string, unknown>,
    packed: readonly string[],
): void {
    const packedSet = new Set(packed);
    const missing = collectTypeDeclarationRefs(pkg).filter((ref) => {
        const full = join(wsDir, ref);
        const onDisk = existsSync(full) && statSync(full).isFile();
        return onDisk && !packedSet.has(ref);
    });
    if (missing.length === 0) return;
    const name = typeof pkg.name === 'string' ? pkg.name : '(unnamed)';
    const filesField = Array.isArray(pkg.files) ? JSON.stringify(pkg.files) : '(none)';
    throw new Error(
        `gjsify pack: ${name} references TypeScript declaration file(s) via "exports"/"types" ` +
            `that exist on disk but are excluded from the tarball by the "files" allowlist (${filesField}):\n` +
            missing.map((m) => `  - ${m}`).join('\n') +
            `\nAdd the missing path(s) to package.json "files" so type resolution isn't silently broken for consumers.`,
    );
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

const DEP_BLOCKS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** Every `<block>.<name>` in `pkg` whose range uses the `workspace:` protocol. */
function collectWorkspaceProtocolDeps(pkg: Record<string, unknown>): string[] {
    const found: string[] = [];
    for (const block of DEP_BLOCKS) {
        const deps = pkg[block] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [name, range] of Object.entries(deps)) {
            if (typeof range === 'string' && range.startsWith('workspace:')) found.push(`${block}.${name}`);
        }
    }
    return found;
}

/**
 * Monorepo root to resolve `workspace:` ranges against.
 *
 * `findWorkspaceRoot` is deliberately strict: it only accepts a candidate root
 * whose OWN `workspaces` globs list `start` as a member (so an unrelated
 * grand-parent monorepo can't be picked up). Packing needs a WIDER answer,
 * because some packages live inside the monorepo on purpose WITHOUT being
 * members — `packages/napi/**` and `packages/node-gi/**` are excluded from
 * `package.json#workspaces` (own CI, own release cadence, see AGENTS.md). For
 * those the strict lookup returns `null`, and the pre-fix code took that as
 * "nothing to do" and shipped the literal `workspace:^` string.
 *
 * So: strict answer first, else the nearest ancestor that declares
 * `workspaces` at all — the monorepo the package physically lives in, whose
 * members are exactly the siblings a `workspace:` range can refer to.
 */
function findPackWorkspaceRoot(start: string): string | null {
    const strict = findWorkspaceRoot(start);
    if (strict) return strict;
    let dir = start;
    for (let i = 0; i < 12; i++) {
        const pkgPath = join(dir, 'package.json');
        if (existsSync(pkgPath) && readPackageJson(pkgPath)?.workspaces !== undefined) return dir;
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/**
 * Walk pkg.dependencies / devDependencies / peerDependencies /
 * optionalDependencies and replace `workspace:^` / `workspace:~` /
 * `workspace:*` ranges with the resolved npm range based on each sibling
 * workspace's version field.
 *
 * A `workspace:` range that survives into a published tarball is unresolvable
 * by EVERY registry client (`npm install` fails with `Unsupported URL Type
 * "workspace:"`), so there is no such thing as a harmless skip here: this
 * either substitutes or throws. Same failure mode, same reasoning as
 * `expandFilesPatterns` above — a packer that silently produces a broken
 * tarball costs a whole release train (v0.4.20, v0.4.37).
 */
function rewriteWorkspaceDeps(pkg: Record<string, unknown>, wsDir: string): Record<string, unknown> {
    const root = findPackWorkspaceRoot(wsDir);
    if (!root) {
        // No enclosing monorepo. Fine for a standalone package — but then a
        // `workspace:` range cannot possibly be resolved, so refuse rather
        // than ship it.
        const unresolvable = collectWorkspaceProtocolDeps(pkg);
        if (unresolvable.length > 0) {
            throw new Error(
                `gjsify pack: ${String(pkg.name)} declares workspace: ranges (${unresolvable.join(', ')}) ` +
                    `but ${wsDir} is not inside a monorepo (no ancestor package.json declares "workspaces"). ` +
                    `A workspace: range cannot be published — replace it with a real npm range, or pack from within the monorepo.`,
            );
        }
        return pkg;
    }
    const siblings = new Map<string, string>();
    for (const ws of discoverWorkspaces(root)) {
        if (ws.name && ws.version) siblings.set(ws.name, ws.version);
    }
    const cloned = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
    for (const block of DEP_BLOCKS) {
        const deps = cloned[block] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [name, range] of Object.entries(deps)) {
            if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
            const wsVer = siblings.get(name);
            if (!wsVer) {
                throw new Error(
                    `gjsify pack: ${cloned.name} declares ${range} on ${name} (${block}) but no sibling workspace with that name exists in the monorepo at ${root}`,
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
