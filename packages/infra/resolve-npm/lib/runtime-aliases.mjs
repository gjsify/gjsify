// Runtime-aware alias derivation.
//
// Each `@gjsify/*` package may declare a `gjsify.runtimes` triplet in its
// `package.json`:
//
//   {
//     "gjsify": {
//       "runtimes": {
//         "gjs":     "polyfill" | "native" | "partial" | "none",
//         "node":    "polyfill" | "native" | "partial" | "none",
//         "browser": "polyfill" | "native" | "partial" | "none"
//       }
//     }
//   }
//
// The bundler's alias resolver consults this triplet when routing bare
// `@gjsify/<X>` specifiers per `--app <target>`:
//
//   slot=polyfill → keep as-is (`@gjsify/<X>` — our impl ships)
//   slot=native   → redirect to `@gjsify/<X>/globals` (re-exports native value)
//   slot=partial  → keep as-is (our impl, gracefully degrades at runtime)
//   slot=none     → redirect to `@gjsify/empty`
//
// Packages without a declared `runtimes` triplet fall through to the hardcoded
// `ALIASES_*` maps in `./index.mjs` — backwards-compatible behavior for the
// infra/gjs/framework packages that opted out of the triplet model.
//
// When a slot=native package is missing the corresponding `globals.mjs`
// re-export file, the resolver emits a warn-once log and falls back to
// `@gjsify/empty` (the current behavior) — surfacing the gap is desirable.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SLOTS = new Set(['polyfill', 'native', 'partial', 'none']);
const VALID_TARGETS = new Set(['gjs', 'node', 'browser']);

/** @typedef {'polyfill'|'native'|'partial'|'none'} Slot */
/** @typedef {{gjs?:Slot, node?:Slot, browser?:Slot}} RuntimeTriplet */
/** @typedef {{name:string, dir:string, runtimes:RuntimeTriplet, hasGlobals:boolean}} PackageRecord */

let _cache = null;
const _warned = new Set();

/**
 * Locate every directory that may contain `@gjsify/*` packages — workspace
 * monorepo source dirs AND installed `node_modules/@gjsify/` farms.
 *
 * Two discovery modes (both checked, results merged):
 *
 *   1. **Workspace mode** — when the resolver is being consulted from inside
 *      the gjsify monorepo itself, walk up from this module to find a
 *      `packages/{node,web,dom,framework,infra}` layout. Returns the
 *      `packages/` root.
 *
 *   2. **Installed mode** — when the resolver is being consulted from a
 *      consumer project's `node_modules/@gjsify/resolve-npm`, the workspace
 *      layout is NOT present. Instead, walk up to find `node_modules/@gjsify/`
 *      and scan every `<pkg>/package.json` there for `gjsify.runtimes`.
 *
 * Returns an array of `{kind, dir}` entries; the caller scans each per its
 * own layout convention.
 */
function findScanRoots() {
    /** @type {Array<{kind:'workspace'|'installed', dir:string}>} */
    const roots = [];

    const here = dirname(fileURLToPath(import.meta.url));
    let cur = here;
    for (let i = 0; i < 8; i++) {
        // Workspace check: <cur>/packages/{node,web,dom,framework,infra}.
        const packagesCandidate = resolve(cur, 'packages');
        if (existsSync(packagesCandidate)) {
            try {
                const stamp = ['node', 'web', 'dom', 'framework', 'infra'].some((s) =>
                    existsSync(join(packagesCandidate, s)),
                );
                if (stamp) roots.push({ kind: 'workspace', dir: packagesCandidate });
            } catch {
                // ignore
            }
        }

        // Installed check: <cur>/node_modules/@gjsify (single-flat npm layout).
        const installedCandidate = resolve(cur, 'node_modules', '@gjsify');
        if (existsSync(installedCandidate)) {
            roots.push({ kind: 'installed', dir: installedCandidate });
        }

        const parent = dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }
    // Also scan the consumer project's cwd-side node_modules — the resolver
    // is invoked from the bundler's process (running in the consumer project),
    // so cwd is a meaningful root even when this module's own dirname is in a
    // hoisted location.
    try {
        const cwdRoot = resolve(process.cwd(), 'node_modules', '@gjsify');
        if (existsSync(cwdRoot)) roots.push({ kind: 'installed', dir: cwdRoot });
    } catch {
        // process.cwd() can throw in unusual environments; ignore.
    }
    return roots;
}

/**
 * @param {string} dir
 * @param {Map<string,PackageRecord>} out
 */
async function ingestPackageDir(dir, out) {
    const pkgJsonPath = join(dir, 'package.json');
    if (!existsSync(pkgJsonPath)) return;
    try {
        const raw = await readFile(pkgJsonPath, 'utf8');
        const json = JSON.parse(raw);
        const name = typeof json.name === 'string' ? json.name : null;
        const runtimes = json?.gjsify?.runtimes;
        if (
            name &&
            name.startsWith('@gjsify/') &&
            !out.has(name) &&
            runtimes &&
            typeof runtimes === 'object'
        ) {
            /** @type {RuntimeTriplet} */
            const triplet = {};
            for (const t of VALID_TARGETS) {
                const v = runtimes[t];
                if (typeof v === 'string' && VALID_SLOTS.has(v)) {
                    triplet[t] = v;
                }
            }
            const hasGlobals = existsSync(join(dir, 'globals.mjs'));
            out.set(name, { name, dir, runtimes: triplet, hasGlobals });
        }
    } catch {
        // Ignore unreadable / invalid package.json
    }
}

/**
 * @param {string} dir
 * @param {Map<string,PackageRecord>} out
 */
function ingestPackageDirSync(dir, out) {
    const pkgJsonPath = join(dir, 'package.json');
    if (!existsSync(pkgJsonPath)) return;
    try {
        const raw = readFileSync(pkgJsonPath, 'utf8');
        const json = JSON.parse(raw);
        const name = typeof json.name === 'string' ? json.name : null;
        const runtimes = json?.gjsify?.runtimes;
        if (
            name &&
            name.startsWith('@gjsify/') &&
            !out.has(name) &&
            runtimes &&
            typeof runtimes === 'object'
        ) {
            /** @type {RuntimeTriplet} */
            const triplet = {};
            for (const t of VALID_TARGETS) {
                const v = runtimes[t];
                if (typeof v === 'string' && VALID_SLOTS.has(v)) {
                    triplet[t] = v;
                }
            }
            const hasGlobals = existsSync(join(dir, 'globals.mjs'));
            out.set(name, { name, dir, runtimes: triplet, hasGlobals });
        }
    } catch {
        // Ignore unreadable / invalid package.json
    }
}

/** Walk `packages/**` and collect every `@gjsify/*` package.json + signals. */
async function collectPackages() {
    const scanRoots = findScanRoots();
    /** @type {Map<string, PackageRecord>} */
    const out = new Map();
    if (scanRoots.length === 0) return out;

    /**
     * Workspace walker — descends past `packages/{node,web,…}/<name>/`.
     * @param {string} dir
     */
    async function walkWorkspace(dir) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        if (existsSync(join(dir, 'package.json'))) {
            await ingestPackageDir(dir, out);
            return; // do not descend into package internals
        }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (ent.name === 'node_modules' || ent.name === 'lib' || ent.name === 'dist') continue;
            if (ent.name.startsWith('.')) continue;
            await walkWorkspace(join(dir, ent.name));
        }
    }

    /**
     * Installed walker — `node_modules/@gjsify/<name>/` is one level deep.
     * @param {string} gjsifyDir
     */
    async function walkInstalled(gjsifyDir) {
        let entries;
        try {
            entries = await readdir(gjsifyDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
            if (ent.name.startsWith('.')) continue;
            await ingestPackageDir(join(gjsifyDir, ent.name), out);
        }
    }

    for (const root of scanRoots) {
        if (root.kind === 'workspace') {
            await walkWorkspace(root.dir);
        } else {
            await walkInstalled(root.dir);
        }
    }
    return out;
}

/** Lazy-loaded cache of all declared runtime triplets. */
async function getCache() {
    if (_cache) return _cache;
    _cache = await collectPackages();
    return _cache;
}

/** Synchronous variant — used by the bundler at config-time (one-shot init). */
function getCacheSync() {
    if (_cache) return _cache;
    const scanRoots = findScanRoots();
    /** @type {Map<string, PackageRecord>} */
    const out = new Map();
    if (scanRoots.length === 0) {
        _cache = out;
        return _cache;
    }
    /** @param {string} dir */
    function walkWorkspace(dir) {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        if (existsSync(join(dir, 'package.json'))) {
            ingestPackageDirSync(dir, out);
            return;
        }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (ent.name === 'node_modules' || ent.name === 'lib' || ent.name === 'dist') continue;
            if (ent.name.startsWith('.')) continue;
            walkWorkspace(join(dir, ent.name));
        }
    }
    /** @param {string} gjsifyDir */
    function walkInstalled(gjsifyDir) {
        let entries;
        try {
            entries = readdirSync(gjsifyDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
            if (ent.name.startsWith('.')) continue;
            ingestPackageDirSync(join(gjsifyDir, ent.name), out);
        }
    }
    for (const root of scanRoots) {
        if (root.kind === 'workspace') walkWorkspace(root.dir);
        else walkInstalled(root.dir);
    }
    _cache = out;
    return _cache;
}

/**
 * Emit a one-shot warning. Subsequent calls with the same key are silent.
 *
 * @param {string} key
 * @param {string} message
 */
function warnOnce(key, message) {
    if (_warned.has(key)) return;
    _warned.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[@gjsify/resolve-npm] ${message}`);
}

/**
 * Given a package record + target runtime, resolve the alias target.
 *
 * @param {PackageRecord} rec
 * @param {'gjs'|'node'|'browser'} target
 * @returns {string|null} The alias target specifier, or null if no rewrite applies.
 */
function resolveSlot(rec, target) {
    const slot = rec.runtimes[target];
    if (!slot) return null; // Slot undeclared → no opinion, leave to hardcoded maps.
    switch (slot) {
        case 'polyfill':
        case 'partial':
            // Keep as-is — bundler resolves `@gjsify/<X>` to its `lib/esm/index.js`.
            return null;
        case 'native':
            if (rec.hasGlobals) {
                return `${rec.name}/globals`;
            }
            warnOnce(
                `${rec.name}-${target}-native-missing-globals`,
                `${rec.name} declares runtimes.${target}="native" but ships no globals.mjs — falling back to @gjsify/empty for --app ${target} builds.`,
            );
            return '@gjsify/empty';
        case 'none':
            return '@gjsify/empty';
        default:
            return null;
    }
}

/**
 * Build the derived `@gjsify/<X>` alias map for the given target runtime.
 *
 * The returned map only contains entries whose source specifier starts with
 * `@gjsify/` — it is meant to be merged on top of the hardcoded `ALIASES_*`
 * maps in `./index.mjs`. Entries already present in the hardcoded maps win
 * (callers should `{ ...derived, ...hardcoded }` to preserve current behavior
 * for packages opted out of the triplet model).
 *
 * @param {'gjs'|'node'|'browser'} target
 * @returns {Record<string,string>}
 */
export function getDerivedAliasesSync(target) {
    if (!VALID_TARGETS.has(target)) return {};
    const cache = getCacheSync();
    /** @type {Record<string,string>} */
    const out = {};
    for (const rec of cache.values()) {
        const alias = resolveSlot(rec, target);
        if (alias !== null && alias !== rec.name) {
            out[rec.name] = alias;
        }
    }
    return out;
}

/**
 * Async variant of {@link getDerivedAliasesSync} — preferred when callable from
 * an async config hook.
 *
 * @param {'gjs'|'node'|'browser'} target
 * @returns {Promise<Record<string,string>>}
 */
export async function getDerivedAliases(target) {
    if (!VALID_TARGETS.has(target)) return {};
    const cache = await getCache();
    /** @type {Record<string,string>} */
    const out = {};
    for (const rec of cache.values()) {
        const alias = resolveSlot(rec, target);
        if (alias !== null && alias !== rec.name) {
            out[rec.name] = alias;
        }
    }
    return out;
}

/**
 * Reset the in-memory cache. Test-only — production code should never call
 * this. Exposed so the e2e suite can force a re-scan after writing fixtures.
 */
export function resetRuntimeAliasesCache() {
    _cache = null;
    _warned.clear();
}

/** Expose the raw declaration map (read-only) for diagnostics. */
export async function listDeclaredRuntimes() {
    const cache = await getCache();
    return new Map(cache);
}
