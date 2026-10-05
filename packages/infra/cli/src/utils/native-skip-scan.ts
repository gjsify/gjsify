// Scan for files the Node oxfmt would format but the native one (GJS) skips.
//
// `@gjsify/oxfmt-native` is oxfmt built WITHOUT its `napi` feature. That build
// formats JS/TS, JSON, TOML, GraphQL and CSS/SCSS/Less itself, but the formats
// oxfmt hands to its Prettier host (Markdown, HTML, Vue, YAML, …) are not even
// classified: oxfmt's walker drops them without a word. `gjsify format --check`
// under GJS would then exit 0 on a tree that the Node CLI finds unformatted.
//
// The answer is only honest when it is asked about the SAME file set oxfmt
// walks. The first version of this scan walked everything, `node_modules/`
// included, read no ignore file and flagged CSS the native build formats; on
// this repository `format --check` exited 1 on dependency READMEs without ever
// starting oxfmt. So the walk mirrors oxfmt's (refs/oxc
// `apps/oxfmt/src/cli/{walk,resolve}.rs`, `crates/oxc_config/src/walk.rs`):
//
//   - VCS directories and `node_modules` are never entered;
//   - hidden directories are walked, not skipped: oxfmt's walk sets
//     `.hidden(false)` and the CLI adds no hidden-file filter (verified
//     against oxlint 1.72.0 / oxfmt 0.61.0), so the scan mirrors the tools
//     rather than freezing a bug — a dot-directory like `.worktrees` is
//     a real scan candidate;
//   - `.prettierignore` in cwd and `!`-prefixed CLI paths block everywhere;
//   - `.gitignore` (nested, plus parents up to the repository root) and
//     `.git/info/exclude` apply to walked entries — only inside a repository
//     when every walk root is in one, everywhere when not;
//   - the config's `ignorePatterns` apply to every file, relative to the
//     config's directory; with no explicit config a nested `.oxfmtrc.json(c)`
//     scopes its subtree, like oxfmt's nested-config discovery;
//   - a file named directly is not held to `.gitignore`, as in oxfmt;
//   - symlinks are not followed.
//
// Only a file that survives all of that AND that napi oxfmt would route to its
// external formatter is reported.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { compileGitignore, globToRegexSource, readGitignoreFile, type GitignoreMatcher } from './gitignore.js';

const parsers = (parser: string, keys: string[]): Record<string, string> =>
    Object.fromEntries(keys.map((k) => [k, parser]));

// oxfmt `core/support.rs`: the `#[cfg(feature = "napi")]` sets behind
// `get_external_parser_name`. Matched case-sensitively, as oxfmt does.
const EXTERNAL_BY_EXTENSION: Record<string, string> = {
    ...parsers('yaml', ['yml', 'mir', 'reek', 'rviz', 'sublime-syntax', 'syntax', 'yaml', 'yaml-tmlanguage']),
    ...parsers('markdown', [
        'md',
        'livemd',
        'markdown',
        'mdown',
        'mdwn',
        'mkd',
        'mkdn',
        'mkdown',
        'ronn',
        'scd',
        'workbook',
    ]),
    ...parsers('html', ['html', 'hta', 'htm', 'inc', 'xht', 'xhtml']),
    ...parsers('glimmer', ['handlebars', 'hbs']),
    mdx: 'mdx',
    vue: 'vue',
    svelte: 'svelte',
    mjml: 'mjml',
};

const EXTERNAL_BY_FILENAME: Record<string, string> = {
    ...parsers('yaml', ['.clang-format', '.clang-tidy', '.clangd', '.gemrc', 'CITATION.cff', 'glide.lock']),
    ...parsers('yaml', ['pixi.lock', '.prettierrc', '.stylelintrc', '.lintstagedrc']),
    ...parsers('markdown', ['contents.lr', 'README']),
};

// Machine-written files oxfmt refuses before classifying — `pnpm-lock.yaml`
// would otherwise look like YAML the native build skipped.
const EXCLUDE_FILENAMES = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'MODULE.bazel.lock',
    'bun.lock',
    'deno.lock',
    'composer.lock',
    'Package.resolved',
    'Pipfile.lock',
    'flake.lock',
    'mcmod.info',
    'Cargo.lock',
    'Gopkg.lock',
    'pdm.lock',
    'poetry.lock',
    'uv.lock',
]);

const VCS_DIRS = new Set(['.git', '.jj', '.sl', '.svn', '.hg']);
const CONFIG_NAMES = ['.oxfmtrc.json', '.oxfmtrc.jsonc'];

interface OxfmtScope {
    dir: string;
    ignore: GitignoreMatcher | null;
    svelte: boolean;
}

/**
 * The Prettier parser napi oxfmt would format `fileName` with, or `null` when
 * the native build formats it itself or no oxfmt formats it. `svelte` counts
 * only when the config enables it, as in oxfmt.
 */
export function externalParserFor(fileName: string, svelteEnabled = false): string | null {
    if (EXCLUDE_FILENAMES.has(fileName)) return null;
    const ext = extname(fileName).slice(1);
    const parser = EXTERNAL_BY_FILENAME[fileName] ?? (ext ? EXTERNAL_BY_EXTENSION[ext] : undefined) ?? null;
    if (parser === 'svelte' && !svelteEnabled) return null;
    return parser;
}

export interface NativeSkipScanOptions {
    /** The `--config` handed to oxfmt. Absent → discovery, as in oxfmt. */
    configPath?: string;
}

export interface NativeSkipScanResult {
    /** Files napi oxfmt would format that the native build skips. */
    skipped: string[];
    /** Files the walk hands to oxfmt's classifier. */
    total: number;
}

/** Walk `paths` the way oxfmt does and report what the native build skips. */
export function scanForNativeSkips(
    paths: string[],
    cwd: string = process.cwd(),
    options: NativeSkipScanOptions = {},
): NativeSkipScanResult {
    const skipped: string[] = [];
    let total = 0;

    const excludes = paths.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
    const globals: GitignoreMatcher[] = [];
    const prettierignore = readGitignoreFile(join(cwd, '.prettierignore'));
    if (prettierignore) globals.push(prettierignore);
    if (excludes.length) globals.push(compileGitignore(excludes, cwd));
    const globallyIgnored = (p: string, isDir: boolean, anyParent: boolean): boolean =>
        globals.some((g) => (anyParent ? g.matchedPathOrAnyParents(p, isDir) : g.matched(p, isDir)) === 'ignore');

    const explicitConfig = options.configPath ? resolve(cwd, options.configPath) : null;
    const rootScope = loadScope(explicitConfig ?? discoverConfig(cwd));
    const nested = explicitConfig === null;
    const scopeFor = (dir: string): OxfmtScope | null => (nested ? nearestScope(dir, rootScope) : rootScope);

    // oxfmt matches CLI globs with fast_glob::glob_match, which expands `{a,b}`
    // brace groups (nested too); globToRegexSource — the gitignore translator —
    // escapes the braces instead, so a brace glob would match nothing. Expand
    // them into alternatives first. Gitignore patterns never carry braces, so
    // this stays a CLI-glob-only translation.
    const expandBraces = (glob: string): string[] => {
        const m = /\{([^{}]*)\}/.exec(glob);
        if (!m) return [glob];
        return m[1]
            .split(',')
            .flatMap((alt) => expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)));
    };

    // An argument that names nothing on disk but carries glob characters is a
    // pattern: oxfmt then walks cwd and keeps the files it matches.
    const globs: RegExp[] = [];
    const targets = new Set<string>();
    for (const p of paths) {
        if (p.startsWith('!')) continue;
        const abs = resolve(cwd, p);
        if (/[*?[{]/.test(p) && !existsSync(abs)) {
            for (const alt of expandBraces(p)) {
                globs.push(new RegExp(`^${globToRegexSource(alt.includes('/') ? alt : `**/${alt}`)}$`));
            }
        } else {
            targets.add(abs);
        }
    }
    if (globs.length || targets.size === 0) targets.add(resolve(cwd));

    const record = (file: string, scope: OxfmtScope | null): void => {
        if (scope?.ignore?.matchedPathOrAnyParents(file, false) === 'ignore') return;
        total++;
        if (externalParserFor(basename(file), scope?.svelte)) skipped.push(file);
    };

    const walkRoots: string[] = [];
    for (const target of targets) {
        let st;
        try {
            st = statSync(target);
        } catch {
            continue;
        }
        if (globallyIgnored(target, st.isDirectory(), true)) continue;
        if (st.isDirectory()) walkRoots.push(target);
        else if (st.isFile()) record(target, scopeFor(dirname(target)));
    }

    const matchesGlob = (file: string): boolean => {
        if (!globs.length || targets.has(file)) return true;
        const rel = relative(cwd, file).split(sep).join('/');
        return globs.some((g) => g.test(rel));
    };

    const seen = new Set<string>();
    const walk = (dir: string, inherited: GitignoreMatcher[], scope: OxfmtScope | null): void => {
        if (seen.has(dir)) return;
        seen.add(dir);
        const own = readGitignoreFile(join(dir, '.gitignore'));
        const stack = own ? [own, ...inherited] : inherited;
        if (nested && dir !== scope?.dir) scope = scopeAt(dir) ?? scope;

        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            const isDir = entry.isDirectory();
            if (!isDir && !entry.isFile()) continue;
            if (isDir && (VCS_DIRS.has(entry.name) || entry.name === 'node_modules')) continue;
            if (globallyIgnored(full, isDir, false) || gitIgnored(stack, full, isDir)) continue;
            if (isDir) walk(full, stack, scope);
            else if (matchesGlob(full)) record(full, scope);
        }
    };

    const requireGit = walkRoots.every((r) => repoRootOf(r) !== null);
    for (const root of walkRoots) {
        walk(root, parentGitignores(root, requireGit ? repoRootOf(root) : null, requireGit), scopeFor(root));
    }

    return { skipped, total };
}

/** Nearest-first: the first matcher that decides wins, as in the `ignore` crate. */
function gitIgnored(stack: readonly GitignoreMatcher[], path: string, isDir: boolean): boolean {
    for (const m of stack) {
        const hit = m.matched(path, isDir);
        if (hit !== null) return hit === 'ignore';
    }
    return false;
}

/**
 * The `.gitignore` files ABOVE a walk root (the walk reads the root's own),
 * nearest first, then `.git/info/exclude`, which ranks below them. Inside a
 * repository the lookup stops at its root, outside one it runs to `/`.
 */
function parentGitignores(root: string, repo: string | null, requireGit: boolean): GitignoreMatcher[] {
    if (requireGit && repo === null) return [];
    const out: GitignoreMatcher[] = [];
    for (let dir = root; dir !== repo;) {
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
        const m = readGitignoreFile(join(dir, '.gitignore'));
        if (m) out.push(m);
    }
    const exclude = repo ? readGitignoreFile(join(repo, '.git', 'info', 'exclude'), repo) : null;
    if (exclude) out.push(exclude);
    return out;
}

function repoRootOf(start: string): string | null {
    for (let dir = start; ; dir = dirname(dir)) {
        if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.jj'))) return dir;
        if (dirname(dir) === dir) return null;
    }
}

function configIn(dir: string): string | null {
    for (const name of CONFIG_NAMES) {
        const p = join(dir, name);
        if (existsSync(p)) return p;
    }
    return null;
}

function discoverConfig(cwd: string): string | null {
    for (let dir = resolve(cwd); ; dir = dirname(dir)) {
        const found = configIn(dir);
        if (found) return found;
        if (dirname(dir) === dir) return null;
    }
}

function scopeAt(dir: string): OxfmtScope | null {
    const cfg = configIn(dir);
    return cfg ? loadScope(cfg) : null;
}

/** The scope of the nearest config at or above `dir`. */
function nearestScope(dir: string, fallback: OxfmtScope | null): OxfmtScope | null {
    for (; ; dir = dirname(dir)) {
        if (fallback && dir === fallback.dir) return fallback;
        const scope = scopeAt(dir);
        if (scope) return scope;
        if (dirname(dir) === dir) return fallback;
    }
}

/**
 * A config's `ignorePatterns`, and whether it enables Svelte. A config that
 * does not parse contributes no patterns — more files reported, never fewer;
 * oxfmt rejects that config anyway.
 */
function loadScope(configPath: string | null): OxfmtScope | null {
    if (!configPath) return null;
    const dir = dirname(configPath);
    let raw: Record<string, unknown> = {};
    try {
        raw = parseJsonc(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    } catch {
        raw = {};
    }
    const patterns = Array.isArray(raw.ignorePatterns)
        ? raw.ignorePatterns.filter((p): p is string => typeof p === 'string')
        : [];
    return {
        dir,
        ignore: patterns.length ? compileGitignore(patterns, dir) : null,
        svelte: raw.svelte !== undefined && raw.svelte !== null && raw.svelte !== false,
    };
}

/** JSON with comments and trailing commas; string contents are never touched. */
export function parseJsonc(text: string): unknown {
    const pass = (src: string, drop: (src: string, i: number) => number): string => {
        let out = '';
        for (let i = 0; i < src.length;) {
            if (src[i] === '"') {
                let j = i + 1;
                while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
                out += src.slice(i, j + 1);
                i = j + 1;
                continue;
            }
            const skip = drop(src, i);
            if (skip > 0) i += skip;
            else out += src[i++];
        }
        return out;
    };
    const uncommented = pass(text, (src, i) => {
        if (src.startsWith('//', i)) {
            const nl = src.indexOf('\n', i);
            return (nl === -1 ? src.length : nl) - i;
        }
        if (src.startsWith('/*', i)) {
            const end = src.indexOf('*/', i + 2);
            return (end === -1 ? src.length : end + 2) - i;
        }
        return 0;
    });
    return JSON.parse(pass(uncommented, (src, i) => (src[i] === ',' && /^\s*[}\]]/.test(src.slice(i + 1)) ? 1 : 0)));
}
