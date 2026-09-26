#!/usr/bin/env node
// A package built with `--app gjs` may not import a Node builtin whose
// `@gjsify/*` substitution is not one of ITS OWN declared workspace
// dependencies.
//
// THE INCIDENT
//
// `@gjsify/tsc` bundles upstream `typescript`'s `_tsc.js` via
// `gjsify build … --app gjs` (see `packages/infra/tsc/scripts/build-bundle.mjs`).
// That entry `require()`s six Node builtins (`fs`, `crypto`, `inspector`, `os`,
// `path`, `perf_hooks`), each of which the `--app gjs` alias layer substitutes
// for a real `@gjsify/*` workspace package — but `@gjsify/tsc`'s manifest
// declared only three unrelated `dependencies`. Nothing ordered the
// substitution targets before `@gjsify/tsc` in `gjsify foreach build -tp`
// (`buildDependencyGraph()` walks declared `dependencies`/`peerDependencies`,
// not what a build actually pulls in through the alias layer), so on a
// narrow-core runner (`cpus().length` concurrency — 3 on the macOS arm64
// image) `@gjsify/tsc` sometimes started building before `@gjsify/fs`
// finished: `UnresolvedWorkspaceImportError: cannot resolve @gjsify/fs, the
// --app gjs substitution for fs`. #1830's `check-build-infra-order.mjs`
// (rule 4) already closes this exact gap for DECLARED workspace deps — this
// is the same defect one layer down, where the dependency is never declared
// at all because nothing about it is visible in the manifest.
//
// WHAT THIS CHECKS
//
// For every workspace package whose `build`/`build:gjsify` script (following
// one `gjsify run <script>` hop, like `check-build-infra-order.mjs`) reaches
// `gjsify build <entry> --app gjs`, and whose `<entry>` resolves to a file
// INSIDE that package's own directory (a THIRD-PARTY entry, like `@gjsify/
// tsc`'s upstream `typescript` file, is invisible to a static scan and is
// reported as skipped, not cleared — see the coverage totals at the end):
// walk the entry's own relative (`./`, `../`) import graph, collect every
// bare specifier reached, and resolve each Node builtin through the same
// `ALIASES_NODE_FOR_GJS` table the bundler uses. Each substitution target
// must be a `dependencies`/`peerDependencies` entry of the SAME package —
// exactly rule 4's bar, applied to an edge the manifest never states.
//
// WHY DEPENDENCIES, NOT BUILD ORDER
//
// Declaring the dependency is the fix that keeps working after this check
// passes once: `buildDependencyGraph()` (`packages/infra/workspace`) already
// orders `gjsify foreach build -tp` — and `check-build-infra-order.mjs`
// rule 4 — off `dependencies`/`peerDependencies`. A declared edge is
// therefore enforced by TWO mechanisms this repo already has; this check's
// only job is making sure the edge gets declared in the first place.
//
// Usage: node scripts/check-builtin-substitution-deps.mjs [--root <dir>]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const rootIndex = process.argv.indexOf('--root');
const ROOT = rootIndex === -1 ? '.' : process.argv[rootIndex + 1];

/** name -> { json, dir }, for every manifest under `packages/<group>/<pkg>/`. */
function packageIndex() {
    const byName = new Map();
    const packagesDir = join(ROOT, 'packages');
    if (!existsSync(packagesDir)) return byName;
    for (const group of readdirSync(packagesDir)) {
        const groupDir = join(packagesDir, group);
        let entries;
        try {
            entries = readdirSync(groupDir);
        } catch {
            continue; // a file, not a group directory
        }
        for (const pkg of entries) {
            const manifest = join(groupDir, pkg, 'package.json');
            if (!existsSync(manifest)) continue;
            try {
                const json = JSON.parse(readFileSync(manifest, 'utf8'));
                if (json.name) byName.set(json.name, { json, dir: join(groupDir, pkg) });
            } catch {
                // A manifest that does not parse is `check-manifests`' problem, not this one.
            }
        }
    }
    return byName;
}

/**
 * Every command a package script runs, following `gjsify run <script>` within the
 * same package — mirrors `check-build-infra-order.mjs`'s `commandsOf`.
 */
function commandsOf(pkg, scriptName, seen = new Set()) {
    if (seen.has(scriptName)) return [];
    seen.add(scriptName);
    const body = pkg.scripts?.[scriptName];
    if (!body) return [];
    const out = [body];
    for (const m of body.matchAll(/gjsify\s+run\s+([\w:.-]+)/g)) {
        out.push(...commandsOf(pkg, m[1], seen));
    }
    return out;
}

/** `gjsify build <entry> … --app gjs` or `node <cli-entry> build <entry> … --app gjs`. */
const APP_GJS_CALL = /(?:gjsify|node\s+\S+)\s+build\s+(\S+)[^&|;]*?--app\s+gjs\b/g;

/** A `node <file>.mjs` helper script, run separately so its OWN source can be inspected. */
const NODE_SCRIPT_CALL = /(?:^|&&|\|\||;)\s*node\s+(\S+\.mjs)(?=\s|$)/g;

/**
 * Whether a build-helper script's SOURCE (not the package.json command line) reaches
 * `--app gjs` — covers `@gjsify/tsc`'s shape, where `spawnSync(..., ['build', entry,
 * '--app', 'gjs', ...])` builds the argv from a runtime-computed `entry` (here
 * `require.resolve('typescript/…')`, a THIRD-PARTY file no static scan of this repo can
 * see). Such an entry cannot be resolved locally, so it is counted as skipped, not
 * cleared — the dependency it needs still has to be declared by hand (see `AGENTS.md`
 * "root-cause" and this incident's PR).
 */
function scriptReachesAppGjs(scriptFile) {
    if (!existsSync(scriptFile)) return false;
    let src;
    try {
        src = readFileSync(scriptFile, 'utf8');
    } catch {
        return false;
    }
    return /--app\b[^)\n]{0,40}\bgjs\b/.test(src);
}

/** Strip `//`/`/* … *​/` comments and template literals, keep ordinary quoted strings. */
function blankNonCode(src) {
    let out = '';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') {
            const start = i;
            while (i < src.length && src[i] !== '\n') i++;
            out += ' '.repeat(i - start);
            i--;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const chunk = src.slice(i, end === -1 ? src.length : end + 2);
            out += chunk.replace(/[^\n]/g, ' ');
            i = end === -1 ? src.length : end + 1;
            continue;
        }
        if (c === '`') {
            let j = i + 1;
            while (j < src.length && !(src[j] === '`' && src[j - 1] !== '\\')) j++;
            out += src.slice(i, j + 1).replace(/[^\n]/g, ' ');
            i = j;
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c) {
                if (src[j] === '\\') j++;
                j++;
            }
            out += src.slice(i, j + 1);
            i = j;
            continue;
        }
        out += c;
    }
    return out;
}

const IMPORT_STATEMENT =
    /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]|^[ \t]*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Every import specifier a file's top-level `import`/`export …from` statements name. */
function specifiersOf(file) {
    let raw;
    try {
        raw = readFileSync(file, 'utf8');
    } catch {
        return [];
    }
    const code = blankNonCode(raw);
    const out = [];
    for (const m of code.matchAll(IMPORT_STATEMENT)) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (spec) out.push(spec);
    }
    return out;
}

const CANDIDATE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/**
 * Resolve a relative or extension-less specifier to a real file, trying index files too.
 *
 * TypeScript ESM specifiers name the emitted `.js` (`./cli-app.js`) while the source on
 * disk is `.ts` — strip a JS-family extension before trying the candidate list, or every
 * TS-authored relative import misses and the walk never leaves the entry file.
 */
function resolveLocal(fromFile, spec) {
    const bareSpec = spec.replace(/\.(m|c)?js$/, '');
    const base = resolve(dirname(fromFile), bareSpec);
    for (const ext of CANDIDATE_EXTENSIONS) {
        const candidate = base + ext;
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    for (const ext of CANDIDATE_EXTENSIONS) {
        const candidate = join(base, `index${ext}`);
        if (ext && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
}

/**
 * Resolve a build clause's `<entry>` argument to a file, honouring only entries that
 * land INSIDE `pkgDir` — a third-party entry (e.g. `@gjsify/tsc`'s upstream `typescript`
 * file, resolved at runtime via `require.resolve`, not spelled in any manifest) is not a
 * static string this check can see, so it is reported as SKIPPED, never as clean.
 */
function resolveEntryInPackage(pkgDir, entryArg) {
    if (/^['"]/.test(entryArg)) return null; // quoted/templated — not a bare path this regex can trust
    const abs = resolve(pkgDir, entryArg);
    if (!existsSync(abs) || !statSync(abs).isFile()) return null;
    const rel = relative(pkgDir, abs);
    if (rel.startsWith('..') || rel.startsWith(sep)) return null; // escapes the package — treat as opaque
    return abs;
}

/** Walk `entry`'s relative import graph inside `pkgDir`; return every specifier reached. */
function collectSpecifiers(entry, pkgDir) {
    const visited = new Set();
    const queue = [entry];
    const specifiers = new Set();
    const CAP = 500; // a runaway walk is a bug in the walker, not a real package
    while (queue.length && visited.size < CAP) {
        const file = queue.shift();
        if (visited.has(file)) continue;
        visited.add(file);
        for (const spec of specifiersOf(file)) {
            specifiers.add(spec);
            if (!spec.startsWith('.')) continue; // only relative specifiers are traversed further
            const next = resolveLocal(file, spec);
            if (next && !visited.has(next) && resolve(next).startsWith(resolve(pkgDir) + sep)) {
                queue.push(next);
            }
        }
    }
    return specifiers;
}

const byName = packageIndex();

/**
 * Workspace root's own `build` script `--exclude "<pattern>"` list — the packages that
 * `gjsify foreach build -tp` (the concurrent, topologically-ordered sweep this check is
 * about) never touches, because they build through a SEQUENTIAL clause elsewhere
 * (`build:infra`, or `@gjsify/cli`'s own trailing `build:gjs-bundle` clause after the
 * sweep). Checking them anyway would flag manifests that are fine under the ordering
 * they actually build under — measured on `@gjsify/cli`, which reaches `node:fs` et al.
 * from `build:gjs-bundle` without declaring any of them, safely, because that clause runs
 * strictly after the sweep has already built every dependency it needs.
 */
function foreachExcludePatterns() {
    const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const buildScript = rootManifest.scripts?.build ?? '';
    return [...buildScript.matchAll(/--exclude\s+"([^"]+)"/g)].map((m) => m[1]);
}

function matchesExcludePattern(name, patterns) {
    return patterns.some((p) => new RegExp(`^${p.split('*').map(escapeRegExp).join('.*')}$`).test(name));
}

function escapeRegExp(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

const excludePatterns = foreachExcludePatterns();
if (!excludePatterns.length) {
    console.error(
        '::error::the root `build` script has no `--exclude` clause any more — this check would then ' +
            'scan every package including ones sequenced outside `gjsify foreach build -tp` on purpose.',
    );
    process.exit(1);
}

const aliasModule = await import(pathToFileURL(join(ROOT, 'packages/infra/resolve-npm/lib/index.mjs')).href);
const ALIASES_NODE_FOR_GJS = aliasModule.ALIASES_NODE_FOR_GJS;
if (!ALIASES_NODE_FOR_GJS) {
    console.error('::error::could not read ALIASES_NODE_FOR_GJS from @gjsify/resolve-npm — this check is blind.');
    process.exit(1);
}

/** Substitution target's PACKAGE name (strips a subpath: 'fs/promises' -> '@gjsify/fs'). */
function targetPackageOf(specifier) {
    const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    const target = ALIASES_NODE_FOR_GJS[bare];
    if (!target) return null;
    return target.split('/').slice(0, 2).join('/');
}

let scanned = 0;
let skippedThirdParty = 0;
let edgesChecked = 0;
const problems = [];

for (const [name, { json, dir }] of byName) {
    if (matchesExcludePattern(name, excludePatterns)) continue;
    // `test`-named scripts bundle spec files, which legitimately reach a
    // devDependency (rule 3's own concern, in `check-build-infra-order.mjs`) —
    // out of scope here, which is about the PRODUCTION dependency graph
    // `buildDependencyGraph()` and rule 4 both order off.
    for (const scriptName of Object.keys(json.scripts ?? {}).filter((s) => !/test/i.test(s))) {
        for (const command of commandsOf(json, scriptName)) {
            let matchedAppGjs = false;
            for (const m of command.matchAll(APP_GJS_CALL)) {
                matchedAppGjs = true;
                const entry = resolveEntryInPackage(dir, m[1]);
                if (!entry) {
                    skippedThirdParty++;
                    continue;
                }
                scanned++;
                const deps = { ...json.dependencies, ...json.peerDependencies };
                for (const spec of collectSpecifiers(entry, dir)) {
                    if (spec.startsWith('.')) continue;
                    const target = targetPackageOf(spec);
                    if (!target || target === name) continue;
                    edgesChecked++;
                    if (deps[target]) continue;
                    problems.push(
                        `${name}'s \`${scriptName}\` bundles ${relative(ROOT, entry).split(sep).join('/')} ` +
                            `with \`--app gjs\`, which imports '${spec}' — the substitution target ${target} ` +
                            `is not in ${name}'s dependencies/peerDependencies, so nothing orders it before ` +
                            `${name} in \`gjsify foreach build -tp\` and a build can race it (the ` +
                            "\"UnresolvedWorkspaceImportError\" #1844's incident describes). Add it as a " +
                            '`workspace:^` dependency.',
                    );
                }
            }
            // A `node <helper>.mjs` build script (@gjsify/tsc's shape): only counted when
            // the inline regex above found nothing, so a helper that ALSO has an inline
            // `--app gjs` clause is not double-reported.
            if (!matchedAppGjs) {
                for (const m of command.matchAll(NODE_SCRIPT_CALL)) {
                    const scriptFile = resolve(dir, m[1]);
                    if (scriptReachesAppGjs(scriptFile)) skippedThirdParty++;
                }
            }
        }
    }
}

// The positive fact: a check that resolved no local `--app gjs` entry at all must not
// report success — that is a broken regex/resolver, not a clean workspace.
if (!scanned && !skippedThirdParty) {
    console.error(
        '::error::no package resolved a local `--app gjs` build entry — the entry regex or the ' +
            'package scan stopped matching anything.',
    );
    process.exit(1);
}

console.log(
    `builtin-substitution-deps: ${scanned} local \`--app gjs\` entr(y/ies) scanned, ${skippedThirdParty} ` +
        `third-party entr(y/ies) skipped (not statically resolvable), ${edgesChecked} builtin-substitution ` +
        'edge(s) checked.',
);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
    console.error(`builtin-substitution-deps: ${problems.length} problem(s).`);
    process.exit(1);
}
