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
//   slot=polyfill → `@gjsify/<X>/<target>` when the package's `exports` map
//                   declares that platform-entry subpath (ADR 0014), else keep
//                   as-is (`@gjsify/<X>` — the shared impl ships)
//   slot=native   → redirect to `@gjsify/<X>/globals` (re-exports native value)
//   slot=partial  → keep as-is (our impl, gracefully degrades at runtime)
//   slot=none     → no rewrite (the package's polyfill resolves normally;
//                   its GJS-only value-deps are stripped by the bundler's
//                   `gjsImportsEmptyPlugin`; runtime calls into GJS-only
//                   code paths fail with a structured no-op — same shape
//                   as `slot=partial`)
//
// Packages without a declared `runtimes` triplet fall through to the hardcoded
// `ALIASES_*` maps in `./index.mjs` — backwards-compatible behavior for the
// infra/gjs/framework packages that opted out of the triplet model.
//
// When a slot=native package is missing the corresponding `globals.mjs`
// re-export file, the resolver emits a warn-once log and leaves the specifier
// alone — surfacing the gap without gutting the bundle (see `case 'native'`).
//
// ── Platform-entry routing (ADR 0014) ──────────────────────────────────────
//
// `polyfill` is the STRONG promise: "our implementation fully covers this API
// on this runtime". A package can only keep that promise off GJS if the code
// the target actually resolves is free of GLib/Gio. Several packages already
// ship a real per-target implementation (`src/browser.ts` → the `./browser`
// export subpath) but nothing ever routed to it: the root `.` export has no
// `"browser"` condition and the alias layer kept `polyfill` as a no-op, so the
// GJS body was bundled for the browser and every GLib call TypeError'd against
// the `{}` that `gjsImportsEmptyPlugin` substitutes for `@girs/*`.
//
// So: on a NON-gjs target, `slot=polyfill` routes to `@gjsify/<X>/<target>`
// whenever the package's `exports` map declares that subpath. The `gjs` target
// is never rerouted (`src/index.ts` IS the GJS implementation).
//
// `partial` deliberately does NOT route. `partial` is the weak promise ("works
// here, degrades") and the shared body's degradation IS its contract; the
// `partial` packages' platform entries are also not yet at export parity with
// their root entry (`@gjsify/fs`'s `src/browser.ts` is missing 34 value
// exports), so routing them would turn a call-time degradation into a
// build-time MISSING_EXPORT. Reaching parity is exactly the work that promotes
// a package from `partial` to `polyfill`; `scripts/audit-runtimes.mjs`
// (`platform-entry-parity` probe) gates that promotion.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The slot values a declaration may use, and the runtimes it may name.
 *
 * EXPORTED because they are the CANONICAL lists and every hand-retyped copy of the TARGETS
 * has drifted: `lib/index.d.ts` denied `nativescript` for the whole life of the 4th slot,
 * and `scripts/audit-runtimes.mjs` — the gate that would have caught that — carried two
 * more copies of its own (`REACH_TARGETS`, `diffDeclared`'s `slots`). The SLOT VALUES had
 * the opposite problem: nothing outside this file listed them, so nothing outside this file
 * rejected `"Polyfill"` either. Import these; do not retype them. What cannot import them
 * (the `.d.ts` unions, which are types) is held against them by
 * `tests/e2e/runtime-slot-declarations`.
 */
const VALID_SLOTS = new Set(['polyfill', 'native', 'partial', 'none']);
// `react-native` is the 5th target and the only one with no `--app` of its own. Not the
// second: gjsify DOES bundle NativeScript (`--app nativescript`, `app/nativescript.ts`)
// even though `@nativescript/vite` owns the APPLICATION build there. Metro owns a React
// Native application's build the same way, and gjsify has no target under it at all, so
// this slot feeds the ALIAS layer only and `build.ts`'s `choices` stays at four.
// `gjsify build --dialect react-native` is a DIFFERENT axis: it says what the SOURCE is
// written in, not what the PACKAGE runs on, so it is not this slot's sibling and the two
// are never equal.
const VALID_TARGETS = new Set(['gjs', 'node', 'browser', 'nativescript', 'react-native']);

export { VALID_SLOTS, VALID_TARGETS };

/**
 * A runtime a package can declare a slot for. The union for JS callers, referenced from
 * `index.mjs` and from this file's own `@param`s via
 * `import('./runtime-aliases.mjs').Target`. It absorbs four of the six hand-written copies
 * this package carried; the other two, in `index.d.ts`, became a second union
 * (`RuntimeTarget`) on purpose. A `.d.ts` pointing at
 * `import('./runtime-aliases.mjs').Target` hands every consumer without `allowJs` a TS7016
 * against our own shipped `lib/` — measured — so one union there costs a compiler flag in
 * somebody else's tsconfig. `tests/e2e/runtime-slot-declarations` holds `RuntimeTarget`
 * against `VALID_TARGETS` instead. Six copies are how `index.mjs` still named four targets
 * one commit after `VALID_TARGETS` gained the fifth.
 *
 * @typedef {'gjs'|'node'|'browser'|'nativescript'|'react-native'} Target
 */

/**
 * Collect the target names for which `exports` declares a `./<target>`
 * platform-entry subpath. Shared by the sync + async package ingesters so the
 * two paths cannot drift.
 *
 * @param {unknown} exportsField
 * @returns {Set<string>}
 */
function collectPlatformEntries(exportsField) {
    /** @type {Set<string>} */
    const found = new Set();
    if (!exportsField || typeof exportsField !== 'object') return found;
    for (const target of VALID_TARGETS) {
        // The `gjs` target is never a platform entry — `.` IS the GJS impl.
        if (target === 'gjs') continue;
        if (Object.prototype.hasOwnProperty.call(exportsField, `./${target}`)) {
            found.add(target);
        }
    }
    return found;
}

/** @typedef {'polyfill'|'native'|'partial'|'none'} Slot */
/**
 * Per-package runtime slot declaration. Quintuplet (gjs / node / browser /
 * nativescript / react-native). The legacy "triplet" name is kept on the typedef
 * for minimal churn; the type is canonically a quintuplet from VALID_TARGETS'
 * perspective.
 *
 * @typedef {{gjs?:Slot, node?:Slot, browser?:Slot, nativescript?:Slot,
 *            'react-native'?:Slot}} RuntimeTriplet
 */
/**
 * @typedef {{name:string, dir:string, runtimes:RuntimeTriplet, hasGlobals:boolean,
 *            platformEntries:Set<string>}} PackageRecord
 *
 * `platformEntries` holds the target names (`browser` / `nativescript` / …)
 * for which the package's `exports` map declares a `./<target>` subpath — the
 * per-runtime implementation entry that `slot=polyfill` routes to (ADR 0014).
 */

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
            // `existsSync` never throws by contract (the sibling calls above and
            // below rely on that too); `join`/`some` over a literal list are pure.
            const stamp = ['node', 'web', 'dom', 'framework', 'infra'].some((s) =>
                existsSync(join(packagesCandidate, s)),
            );
            if (stamp) roots.push({ kind: 'workspace', dir: packagesCandidate });
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
            const platformEntries = collectPlatformEntries(json?.exports);
            out.set(name, { name, dir, runtimes: triplet, hasGlobals, platformEntries });
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
            const platformEntries = collectPlatformEntries(json?.exports);
            out.set(name, { name, dir, runtimes: triplet, hasGlobals, platformEntries });
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
 * @param {Target} target
 * @returns {string|null} The alias target specifier, or null if no rewrite applies.
 */
function resolveSlot(rec, target) {
    const slot = rec.runtimes[target];
    if (!slot) return null; // Slot undeclared → no opinion, leave to hardcoded maps.
    switch (slot) {
        case 'polyfill':
            // ADR 0014 — platform-entry routing. `polyfill` promises a FULL
            // implementation on this runtime; when the package ships a
            // per-target entry (`exports["./<target>"]`), that entry IS the
            // implementation for the target and the shared `.` body (which on
            // most packages is the GLib/Gio-backed GJS impl) must not be
            // bundled. Never applies to `gjs` — `.` is the GJS impl.
            if (target !== 'gjs' && rec.platformEntries?.has(target)) {
                return `${rec.name}/${target}`;
            }
            // No platform entry → the shared body is the implementation.
            return null;
        case 'partial':
            // Keep as-is — bundler resolves `@gjsify/<X>` to its `lib/esm/index.js`.
            // `partial` does NOT route to a platform entry even when one exists;
            // see the header note (parity is the promotion gate to `polyfill`).
            return null;
        case 'native':
            if (rec.hasGlobals) {
                return `${rec.name}/globals`;
            }
            // No `globals.mjs` behind the promise. Routing to `@gjsify/empty` here
            // was the same MISSING_EXPORT mistake the `none` case below documents,
            // and it cost more: every `packages/nativescript-bridge/*` package is
            // in this state, so `--app nativescript` could not build ANY of them,
            // unnoticed because no CI job built them (`tests/e2e/ns-bridge-bundles`).
            // The warn-once stays — the DECLARATION is still wrong, and settling
            // that vocabulary is its own change (`status/open-todos.md`).
            warnOnce(
                `${rec.name}-${target}-native-missing-globals`,
                `${rec.name} declares runtimes.${target}="native" but ships no globals.mjs — resolving it normally for --app ${target} builds.`,
            );
            return null;
        case 'none':
            // Intentionally no rewrite. The original draft routed `none` to
            // `@gjsify/empty` (idea: shrink GJS-only polyfills out of Node
            // bundles), but that breaks bundles whose own `*.gjs.spec.ts`
            // files import their host package by name — e.g. `@gjsify/tls`'s
            // `session-access.gjs.spec.ts` imports `TLSSocket, connect, …`
            // from `@gjsify/tls`. Empty has none of those exports, so the
            // bundler errors with MISSING_EXPORT before the gjs-spec gets a
            // chance to runtime-guard via `on('Gjs', …)`.
            // Letting `none`-slotted packages resolve normally to the
            // polyfill keeps the bundle valid; the `gjsImportsEmptyPlugin`
            // (added to `--app node` in a prior PR) still strips the
            // `gi://`/`@girs/*` value-deps inside the polyfill so the bundle
            // doesn't crash on load. Consumers calling GJS-only code paths
            // on Node will hit a runtime no-op / structured failure inside
            // the polyfill, which is the documented `partial`-shaped
            // behavior — and exactly what the strategy doc allows.
            return null;
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
 * @param {Target} target
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
 * @param {Target} target
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
