// `@gjsify/nativescript-vite` — Vite 8 / Rolldown compatibility + gjsify
// transforms for building NativeScript apps.
//
// `@nativescript/vite@2.x` (the upstream NativeScript Vite integration, the
// Vite-7-era line) does not build under Vite 8 / Rolldown: its config uses two
// constructs Rolldown rejects. This package COMPOSES the upstream config and
// fixes exactly those pieces on the returned config object, then layers
// gjsify's NS transforms on top — so a NativeScript app builds under Vite 8
// with `gjsify`'s stack.
//
// The upstream incompatibilities (verified by running real builds against
// `@nativescript/vite@2.0.3`):
//   1. Function-replacement `resolve.alias` entries (platform-`main` + tsconfig
//      wildcard + `@nativescript/core/.../index` canonicalization) →
//      `Failed to convert builtin plugin 'ViteAlias' … function replacement
//      into rust type String`. They are DROPPED — the upstream
//      `nativescript-package-resolver` plugin (a `resolveId` hook, kept) and the
//      string `~/` / `@` aliases (kept) already cover the same resolution.
//   2. The explicit `@rollup/plugin-commonjs` plugin → `Cannot read properties
//      of undefined (reading 'currentLoadingModule')`. It is DROPPED — Rolldown
//      handles CommonJS (`@nativescript/core`'s modules) natively.
//   3. The vite-side `ns-typescript-check` plugin → a bundler should bundle,
//      not type-check; gjsify defers the authoritative type gate to
//      `gjsify tsc`. It is DROPPED (the strip is no-op-if-absent).
//
// CONDITIONAL on the installed `@nativescript/vite` major (`detectNativescriptViteMajor()`):
//   - major <= 2 (or UNKNOWN/unresolvable — fail-safe to "patches still needed"):
//     apply the FULL fix set above, exactly as before. The teapot showcase on
//     `@nativescript/vite@2.0.3` must keep building.
//   - major >= 8: upstream `@nativescript/vite@8.x` is a ground-up Vite-8 +
//     Rolldown + HMR rewrite that ALREADY ships native `rolldownOptions`,
//     string-only aliases and no explicit `@rollup/plugin-commonjs`, so fixes
//     (1) and (2) are no-ops there — they are SKIPPED (the intent is explicit;
//     the strips were already no-op-if-absent). Fix (3) is still applied
//     (no-op-if-absent regardless of line). A one-time informational log notes
//     that 8.x handles Vite-8/Rolldown natively so minimal patching is applied.
//
// Every strip is idempotent + no-op-if-absent, so the patching stays safe on
// either line regardless of the detected major.
//
// On top, it spreads `@gjsify/vite-plugin-gjsify`'s `gjsifyNativescript()`
// preset (gi:// → empty, platform file resolution, platform defines, the
// node-builtin alias routing incl. `module` → `@gjsify/module`).
//
// `@nativescript/vite`, `@nativescript/core`, the `nativescript` CLI, the
// optional `@nativescript/canvas*` plugins and `vite` are all OPTIONAL peer
// dependencies — installed by the consumer only when targeting NativeScript.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import type { ConfigEnv, UserConfig, Plugin, AliasOptions, Alias } from 'vite';
import { gjsifyNativescript as gjsifyNativescriptTransforms } from '@gjsify/vite-plugin-gjsify';
import type { GjsifyNativescriptOptions } from '@gjsify/vite-plugin-gjsify';

export type GjsifyNativescriptViteOptions = GjsifyNativescriptOptions;

/** A user-supplied Vite config (or config factory) merged in as the final layer. */
export type UserConfigInput = UserConfig | ((env: ConfigEnv) => UserConfig | Promise<UserConfig>);

/**
 * Build a NativeScript Vite config that works under Vite 8 / Rolldown with
 * gjsify's transforms. Use it as your app's `vite.config.ts`:
 *
 * ```ts
 * import { defineNativescriptConfig } from '@gjsify/nativescript-vite';
 * export default defineNativescriptConfig();
 * ```
 *
 * Compose your own Vite config on top (e.g. externalize a canvas/WebGL app's
 * unused `@nativescript/audio-context`) by passing a second argument — it is
 * `mergeConfig`'d in last, so it wins:
 *
 * ```ts
 * export default defineNativescriptConfig({}, {
 *   build: { rollupOptions: { external: [/@nativescript\/audio-context/] } },
 * });
 * ```
 *
 * Returns an async Vite config FUNCTION (Vite resolves the `mode` and passes it
 * through), so the upstream `@nativescript/vite` config is built for the right
 * mode before the fixes + gjsify transforms are applied.
 *
 * @param options  forwarded to `@gjsify/vite-plugin-gjsify`'s `gjsifyNativescript()` preset.
 * @param userConfig  optional final-layer Vite config (object or `(env) => config`).
 */
export function defineNativescriptConfig(
    options: GjsifyNativescriptViteOptions = {},
    userConfig?: UserConfigInput,
): (env: ConfigEnv) => Promise<UserConfig> {
    return async (env: ConfigEnv): Promise<UserConfig> => {
        const base = await loadUpstreamConfig(env);
        const fixed = applyVite8Fixes(base);
        // Correct `@nativescript/vite`'s fragile "monorepo `packages/core` IS
        // @nativescript/core" heuristic when the HOST monorepo's own packages/core
        // is a DIFFERENT package (see {@link repointMistargetedCoreAlias}).
        repointMistargetedCoreAlias(fixed);
        // Layer gjsify's NS transforms (a Vite plugin array whose `config()` hook
        // supplies the gi:// → empty redirect, platform resolution, defines, and
        // node-builtin aliases) — the same composition proven to produce a
        // working Vite 8 bundle.
        const withTransforms = mergeConfig(fixed, {
            plugins: [...gjsifyNativescriptTransforms(options)] satisfies Plugin[],
        });
        // Stabilise the build output so repeated `ns prepare`/`ns build` runs do
        // not accumulate stale, hashed chunk files the Android SBG then sees as a
        // duplicate native `extends` (see {@link nativescriptSbgBundleSyncFix}).
        const withSbgFix = mergeConfig(withTransforms, nativescriptSbgBundleSyncFix());
        if (userConfig === undefined) return withSbgFix;
        const resolved = typeof userConfig === 'function' ? await userConfig(env) : userConfig;
        return mergeConfig(withSbgFix, resolved);
    };
}

export default defineNativescriptConfig;

/**
 * Stabilise the NativeScript build output so the Android Static Binding
 * Generator never sees a native class extended twice.
 *
 * `@nativescript/vite@8` names non-vendor / non-worker chunks `[name]-[hash].mjs`
 * and leaves `build.emptyOutDir` unset. The NS CLI then copies the staging dir
 * (`.ns-vite-build`) into `platforms/android/app/src/main/assets/app/`
 * ADDITIVELY — it never deletes stale files. So every build whose content
 * changes emits a fresh `activity.android-<hash>.mjs`, and `assets/app` ends up
 * holding TWO of them: the SBG scans both, sees `NativeScriptActivity`'s
 * `extends` declaration twice and aborts with "File already exists … change the
 * name of one of the extended classes". The documented workaround was a manual
 * `rm -rf .ns-vite-build` + `assets/app/*.mjs` before every build.
 *
 * The entry (`bundle.mjs`) and vendor chunk (`vendor.mjs`) are ALREADY stable
 * upstream; this extends that to every chunk (so a rebuild OVERWRITES rather
 * than accumulates) and empties the staging dir each build. Merged over the
 * upstream config but under the user's, so an app can still override it.
 *
 * NOTE: a one-time clean of a pre-existing `assets/app/*.mjs` is still needed to
 * drop chunks that already accumulated; from then on the names stay stable.
 */
export function nativescriptSbgBundleSyncFix(): UserConfig {
    return {
        build: {
            // Clear the staging dir each (non-watch) build so stale chunks don't linger.
            emptyOutDir: true,
            rolldownOptions: {
                output: {
                    // Drop the content hash from chunk names — matching the
                    // already-stable `bundle.mjs` entry + `vendor.mjs` — so a
                    // rebuild overwrites the same files instead of piling up
                    // `activity.android-<hash>.mjs` copies for the SBG to trip on.
                    chunkFileNames: (chunk: { name?: string }): string => {
                        if (chunk.name === 'vendor') return 'vendor.mjs';
                        if (chunk.name && chunk.name.includes('worker')) return '[name].js';
                        return '[name].mjs';
                    },
                },
            },
        },
    };
}

/**
 * Repoint a mis-targeted `@nativescript/core` resolve.alias.
 *
 * `@nativescript/vite`'s base config (`configuration/base.js`) sets the
 * @nativescript/core root to `<project>/../../packages/core` whenever that path
 * EXISTS — without verifying the directory's package name. It assumes the
 * NativeScript monorepo layout, where `packages/core` IS @nativescript/core. In
 * ANY OTHER monorepo whose own `packages/core` is a DIFFERENT package — e.g.
 * `@learn6502/core` in the Learn6502 workspace, or any `packages/core` — that
 * heuristic mis-fires: @nativescript/core is aliased to the wrong package, and
 * every `@nativescript/core/<sub>` import (`globals/index`, `application`,
 * `ui/frame/activity.android`, `inspector_modules`, …) fails to resolve with
 * "No such file or directory", breaking the bundle. (A non-monorepo app, or one
 * without a sibling `packages/core`, falls through to node_modules resolution and
 * is unaffected — which is why it bites only some layouts.)
 *
 * Fix: scan the composed `resolve.alias` and, for any entry targeting
 * @nativescript/core whose replacement directory's `package.json#name` is NOT
 * `@nativescript/core`, repoint the replacement at the REAL installed
 * @nativescript/core (resolved from the project root, `process.cwd()` — where
 * Vite runs the config). Correctly-targeted aliases (a real @nativescript/core,
 * source or node_modules) are left untouched, so this is a safe no-op outside the
 * name-collision case.
 */
function repointMistargetedCoreAlias(config: UserConfig): void {
    const alias = config.resolve?.alias;
    if (!Array.isArray(alias)) return;
    let realRoot: string;
    try {
        const req = createRequire(import.meta.url);
        realRoot = dirname(
            req.resolve('@nativescript/core/package.json', { paths: [process.cwd()] }),
        ).replace(/\\/g, '/');
    } catch {
        return; // @nativescript/core not resolvable from the project — leave config as-is
    }
    repointCoreAliasEntries(alias as Alias[], realRoot, (dir) => {
        try {
            return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string }).name;
        } catch {
            return undefined; // unreadable target → treat as mis-targeted
        }
    });
}

/**
 * Pure core of {@link repointMistargetedCoreAlias} (exported for testing, since
 * the wrapper resolves the real `@nativescript/core` from disk).
 *
 * Mutates `aliases` in place: for every entry whose `find` matches
 * `@nativescript/core`, repoint its string `replacement` at `realRoot` UNLESS the
 * replacement's current root directory already resolves to a real
 * `@nativescript/core` — decided by `nameOf(dir)` returning `'@nativescript/core'`.
 * A trailing `/$1` capture-group suffix is preserved.
 *
 * @internal
 */
export function repointCoreAliasEntries(
    aliases: Alias[],
    realRoot: string,
    nameOf: (dir: string) => string | undefined,
): void {
    for (const entry of aliases) {
        const { find, replacement } = entry;
        if (typeof replacement !== 'string') continue;
        // `find` is a RegExp like /^@nativescript\/core$/; strip escapes to match.
        if (!String(find).replace(/\\/g, '').includes('@nativescript/core')) continue;
        // Replacements look like `${ROOT}` or `${ROOT}/$1` — recover the root dir.
        const currentRoot = replacement.replace(/\/\$1$/, '').replace(/\/+$/, '');
        if (currentRoot === realRoot) continue; // already correct
        if (nameOf(currentRoot) === '@nativescript/core') continue; // a real core elsewhere — keep it
        entry.replacement = replacement.endsWith('/$1') ? `${realRoot}/$1` : realRoot;
    }
}

/**
 * Resolve `@nativescript/vite`'s TypeScript config factory (an optional peer).
 * Prefers the documented root entry (`@nativescript/vite`) and falls back to the
 * `./typescript` subpath that some published versions expose; throws a clear,
 * actionable error if neither resolves or the export is missing.
 */
async function loadUpstreamConfig(env: ConfigEnv): Promise<UserConfig> {
    // `@nativescript/vite@8.x`'s config chain (`configuration/base.js` → the HMR
    // server → the per-framework strategies) STATICALLY imports the framework
    // compilers (`@vue/compiler-sfc`, `react-reconciler`, `vite-plugin-solid`,
    // `@vitejs/plugin-vue{,-jsx}`, `vue-tsc`, `@analogjs/vite-plugin-angular`,
    // `@angular/build`) at module-eval. They are upstream `peerDependencies`, so a
    // framework-LESS NativeScript-Core app (no Vue/Solid/React/Angular) cannot even
    // `import('@nativescript/vite')` — Node throws a cryptic
    // `ERR_MODULE_NOT_FOUND: Cannot find package '@vue/compiler-sfc'`. Stub the
    // ones the project did NOT install with `@gjsify/empty`-shaped no-op modules so
    // a Core app loads the config. Must run BEFORE the dynamic import below —
    // `resolve.alias` (a Vite config field) would be far too late: the eager import
    // is executed by Node's ESM loader the moment we `import()` the config module.
    stubMissingFrameworkPeers();

    // String-variable specifiers: `@nativescript/vite` is an OPTIONAL peer, not
    // installed in this repo, so a literal `import('@nativescript/vite')` would
    // fail type resolution. Non-literal specifiers resolve at runtime only (the
    // consumer's NS app provides the package). Root is the documented entry
    // (`export { typescriptConfig }`); the subpath is a fallback for versions
    // whose `exports` map exposes `./typescript` but not the root re-export.
    const candidates = ['@nativescript/vite', '@nativescript/vite/typescript'];
    let lastError: unknown;
    for (const specifier of candidates) {
        let mod: { typescriptConfig?: unknown };
        try {
            mod = (await import(specifier)) as { typescriptConfig?: unknown };
        } catch (cause) {
            lastError = cause;
            continue;
        }
        const { typescriptConfig } = mod;
        if (typeof typescriptConfig === 'function') {
            return (typescriptConfig as (opts: { mode: string }) => UserConfig)({ mode: env.mode });
        }
        lastError = new Error(`"${specifier}" resolved but did not export a "typescriptConfig" function`);
    }
    throw new Error(
        '@gjsify/nativescript-vite requires the optional peer "@nativescript/vite" exporting `typescriptConfig` ' +
            '(install it alongside @nativescript/core in your NativeScript app).',
        { cause: lastError },
    );
}

/** One-time guard so the missing-framework-peer stub notice prints at most once per process. */
let stubbedPeersNoticeShown = false;
/** Idempotency guard: register the Node resolve/load hooks at most once per process. */
let frameworkPeerHooksRegistered = false;

/**
 * Read `@nativescript/vite`'s declared framework `peerDependencies`. These are the
 * Vue/Solid/React/Angular compilers (`@vue/compiler-sfc`, `react-reconciler`,
 * `vite-plugin-solid`, `@vitejs/plugin-vue{,-jsx}`, `vue-tsc`,
 * `@analogjs/vite-plugin-angular`, `@angular/build`) that the 8.x config chain
 * STATICALLY imports at module-eval. Returns `[]` when the package can't be
 * located (optional peer absent → nothing to stub, the upstream import will fail
 * with its own clear error).
 */
function nativescriptViteFrameworkPeers(): string[] {
    const root = resolveNativescriptViteRoot();
    if (root === undefined) return [];
    try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
            peerDependencies?: Record<string, unknown>;
        };
        return Object.keys(pkg.peerDependencies ?? {});
    } catch {
        return [];
    }
}

/**
 * Find every framework `peerDependency` of `@nativescript/vite` that the consuming
 * project did NOT install, resolved relative to `@nativescript/vite`'s own location
 * (peers resolve from the package that declares them) with a `process.cwd()`
 * fallback. NEVER stubs a framework the app actually has — only the absent ones.
 */
function missingFrameworkPeers(): string[] {
    const root = resolveNativescriptViteRoot();
    if (root === undefined) return [];
    const require = createRequire(import.meta.url);
    const paths = [root, process.cwd()];
    return nativescriptViteFrameworkPeers().filter((peer) => {
        try {
            require.resolve(peer, { paths });
            return false; // resolvable → installed → keep it
        } catch {
            return true; // unresolvable → missing → stub it
        }
    });
}

/** Synthetic-module URL scheme for a stubbed missing framework peer. */
const STUB_PEER_SCHEME = 'gjsify-ns-empty-peer:';

/**
 * Scan `@nativescript/vite`'s on-disk source for the NAMED imports of `spec`
 * (`import { parse, compileScript } from '<spec>'`). ESM validates named bindings
 * at link time, so a default-only stub (like `@gjsify/empty`) cannot satisfy
 * `import { compileScript } from '@vue/compiler-sfc'` — the generated stub must
 * declare exactly those names. Version-agnostic: reads whatever the installed
 * `@nativescript/vite` actually imports.
 */
function collectNamedImports(root: string, spec: string): string[] {
    const names = new Set<string>();
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`, 'g');
    const walk = (dir: string): void => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const name of entries) {
            const p = join(dir, name);
            let isDir: boolean;
            try {
                isDir = statSync(p).isDirectory();
            } catch {
                continue;
            }
            if (isDir) {
                if (name !== 'node_modules') walk(p);
            } else if (p.endsWith('.js') || p.endsWith('.mjs')) {
                let code: string;
                try {
                    code = readFileSync(p, 'utf8');
                } catch {
                    continue;
                }
                let m: RegExpExecArray | null;
                re.lastIndex = 0;
                while ((m = re.exec(code)) !== null) {
                    for (const raw of m[1].split(',')) {
                        const imported = raw.trim().split(/\s+as\s+/)[0]?.trim();
                        if (imported && /^[A-Za-z_$][\w$]*$/.test(imported)) names.add(imported);
                    }
                }
            }
        }
    };
    walk(root);
    return [...names];
}

/**
 * Make a framework-LESS NativeScript-Core app able to load `@nativescript/vite@8.x`'s
 * config: stub the framework compiler `peerDependencies` the project did not install
 * with no-op modules, so the chain's eager `import '@vue/compiler-sfc'` (etc.)
 * resolve to empty stubs instead of throwing `ERR_MODULE_NOT_FOUND`.
 *
 * Uses Node's synchronous module hooks (`module.registerHooks`, Node 22.15+/24):
 *   - a `resolve` hook redirects each missing peer specifier to a synthetic stub URL;
 *   - a `load` hook returns ESM source exporting a no-op default Proxy PLUS a named
 *     export (also the Proxy) for every name `@nativescript/vite` imports from that
 *     peer — satisfying namespace / default / named imports of any shape.
 *
 * Idempotent (registers at most once) and a no-op when no framework peer is missing
 * (a Vue/Solid/React/Angular app keeps its real compilers). Falls back gracefully —
 * if `registerHooks` is unavailable (older Node) it logs the actionable
 * `npm install` hint and lets the upstream import surface its own error.
 */
function stubMissingFrameworkPeers(): void {
    if (frameworkPeerHooksRegistered) return;
    const missing = missingFrameworkPeers();
    if (missing.length === 0) return;

    const root = resolveNativescriptViteRoot();
    const registerHooks = (module as { registerHooks?: (h: unknown) => void }).registerHooks;
    if (root === undefined || typeof registerHooks !== 'function') {
        // Can't intercept — give the user the exact remedy instead of the raw
        // `ERR_MODULE_NOT_FOUND` they'd otherwise hit at config-load.
        console.warn(
            `[@gjsify/nativescript-vite] @nativescript/vite eagerly imports framework compilers that are not ` +
                `installed and they cannot be stubbed on this Node version. Install the ones your app uses, ` +
                `or all of them to unblock the build:\n    npm install -D ${missing.join(' ')}`,
        );
        return;
    }

    frameworkPeerHooksRegistered = true;
    const missingSet = new Set(missing);
    // Pre-compute the named-export superset per missing peer so the load hook stays
    // synchronous and cheap (the scan reads the upstream source once).
    const namedExports = new Map<string, string[]>();
    for (const peer of missing) namedExports.set(peer, collectNamedImports(root, peer));

    if (!stubbedPeersNoticeShown) {
        stubbedPeersNoticeShown = true;
        // stderr (console.warn) — a build diagnostic must not pollute stdout.
        console.warn(
            `[@gjsify/nativescript-vite] @nativescript/vite declares framework compilers as peerDependencies and ` +
                `imports them eagerly at config-load; stubbing the ${missing.length} not installed in this project ` +
                `with no-op modules so a framework-less NativeScript-Core app can load the config: ${missing.join(', ')}. ` +
                `(Install a framework's compiler to use it — only the absent ones are stubbed.)`,
        );
    }

    registerHooks({
        resolve(
            specifier: string,
            context: unknown,
            nextResolve: (s: string, c: unknown) => unknown,
        ): unknown {
            if (missingSet.has(specifier)) {
                return { url: STUB_PEER_SCHEME + encodeURIComponent(specifier), shortCircuit: true };
            }
            return nextResolve(specifier, context);
        },
        load(url: string, context: unknown, nextLoad: (u: string, c: unknown) => unknown): unknown {
            if (url.startsWith(STUB_PEER_SCHEME)) {
                const spec = decodeURIComponent(url.slice(STUB_PEER_SCHEME.length));
                const named = namedExports.get(spec) ?? [];
                let source =
                    'const noop = () => {};\n' +
                    'const stub = new Proxy(noop, { get: (t, p) => (p in t ? t[p] : noop) });\n' +
                    'export default stub;\n';
                for (const name of named) source += `export const ${name} = stub;\n`;
                return { format: 'module', source, shortCircuit: true };
            }
            return nextLoad(url, context);
        },
    });
}

/** Upstream `@nativescript/vite` TypeScript-check plugin name (see `helpers/typescript-check.js`). */
const TS_CHECK_PLUGIN = 'ns-typescript-check';

/** First `@nativescript/vite` major that ships native Vite-8 / Rolldown support. */
const NS_VITE_NATIVE_VITE8_MAJOR = 8;

/** One-time guard so the "8.x handles Vite-8 natively" notice prints at most once per process. */
let nativeViteNoticeShown = false;

/**
 * Locate the on-disk `@nativescript/vite` package root (the directory holding its
 * `package.json`), or `undefined` when the optional peer is not installed.
 *
 * It must NOT resolve the `@nativescript/vite/package.json` SUBPATH directly:
 * `@nativescript/vite@8.x`'s `package.json#exports` map does not expose
 * `./package.json`, so `createRequire(...).resolve('@nativescript/vite/package.json')`
 * (and `import.meta.resolve`) throw `ERR_PACKAGE_PATH_NOT_EXPORTED` — the bug that
 * silently broke major detection on the 8.x line (the gate never fired, the full
 * legacy patch set ran). Instead resolve the package's MAIN entry (always exported)
 * and walk up to the nearest ancestor `package.json` whose `name` is
 * `@nativescript/vite`. This is robust for both modern `exports`-only packages and
 * classic ones.
 */
function resolveNativescriptViteRoot(): string | undefined {
    const specifier = '@nativescript/vite';
    const require = createRequire(import.meta.url);
    // Resolve from the consumer's project root (`process.cwd()` — where Vite runs
    // the config) FIRST, then relative to this lib's own location. In a flat npm
    // install both find the same copy; resolving from the project root first is the
    // honest source of truth (the app's installed `@nativescript/vite` is the one
    // its config will load) and handles pnpm/nested layouts where the lib's
    // `node_modules` differs from the project's.
    let entry: string | undefined;
    try {
        entry = require.resolve(specifier, { paths: [process.cwd(), dirname(fileURLToPath(import.meta.url))] });
    } catch {
        // fall through to import.meta.resolve (location-relative)
    }
    if (entry === undefined) {
        const metaResolve = (import.meta as { resolve?: (s: string) => string }).resolve;
        if (typeof metaResolve === 'function') {
            try {
                const resolved = metaResolve(specifier);
                entry = resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved;
            } catch {
                return undefined; // genuinely not installed
            }
        } else {
            return undefined;
        }
    }

    // Walk up from the resolved entry file to the nearest `package.json` named
    // `@nativescript/vite` (skips a possible inner `package.json` in a subdir).
    let dir = dirname(entry);
    for (;;) {
        const pkgPath = join(dir, 'package.json');
        if (existsSync(pkgPath)) {
            try {
                const name = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown }).name;
                if (name === specifier) return dir;
            } catch {
                // unreadable/unparseable — keep walking up
            }
        }
        const parent = dirname(dir);
        if (parent === dir) return undefined; // reached filesystem root
        dir = parent;
    }
}

/**
 * Detect the installed `@nativescript/vite` major version. `@nativescript/vite` is
 * an OPTIONAL peer (not installed in this repo), so detection can fail — in which
 * case we return `undefined` and the caller assumes the patches are still needed
 * (fail-safe to the historical full-patch behavior).
 *
 * Reads the package root's `package.json` (located WITHOUT relying on the
 * exports-gated `/package.json` subpath, see `resolveNativescriptViteRoot`) and
 * parses its `version`. Any failure (unresolvable peer, unreadable/unparseable
 * version) is swallowed → `undefined`.
 */
export function detectNativescriptViteMajor(): number | undefined {
    const root = resolveNativescriptViteRoot();
    if (root === undefined) return undefined; // not resolvable — assume patches still needed
    try {
        const raw = readFileSync(join(root, 'package.json'), 'utf8');
        const version = (JSON.parse(raw) as { version?: unknown }).version;
        if (typeof version !== 'string') return undefined;
        const major = Number.parseInt(version.split('.', 1)[0] ?? '', 10);
        return Number.isFinite(major) ? major : undefined;
    } catch {
        return undefined; // unreadable / unparseable — assume patches still needed
    }
}

/**
 * Apply the Vite 8 / Rolldown + type-check fixes to a returned `@nativescript/vite`
 * config: drop function-replacement aliases, the explicit `@rollup/plugin-commonjs`,
 * and the vite-side `ns-typescript-check` (gjsify type-checks via `gjsify tsc`).
 * Returns a shallow copy with the fixed `resolve` and `plugins` — the input is not
 * mutated.
 *
 * CONDITIONAL on the installed `@nativescript/vite` major:
 *   - `>= 8` (the Vite-8 + Rolldown + HMR rewrite): SKIP the function-alias drop
 *     and the `@rollup/plugin-commonjs` strip — upstream already ships native
 *     `rolldownOptions`, string-only aliases and no explicit commonjs plugin, so
 *     those fixes are no-ops there. The `ns-typescript-check` strip is still
 *     applied (no-op-if-absent). Emits a one-time informational notice.
 *   - `<= 2` / UNKNOWN (unresolvable peer): apply the FULL fix set, exactly as
 *     before — the teapot showcase on `@nativescript/vite@2.0.3` must keep building.
 *
 * The optional `nsViteMajor` arg overrides the auto-detected major (used by the
 * e2e fixtures to exercise both branches without two installs).
 */
export function applyVite8Fixes(config: UserConfig, nsViteMajor?: number): UserConfig {
    const major = nsViteMajor ?? detectNativescriptViteMajor();
    // Fail-safe: an unknown major (optional peer not resolvable) is treated as
    // the legacy <= 2 line so the full patch set still applies.
    const skipVite8Patches = major !== undefined && major >= NS_VITE_NATIVE_VITE8_MAJOR;

    const out: UserConfig = { ...config };

    if (skipVite8Patches) {
        // One-time informational notice — upstream 8.x handles Vite-8/Rolldown
        // natively, so only the bundler-shouldn't-type-check strip is applied.
        if (!nativeViteNoticeShown) {
            nativeViteNoticeShown = true;
            console.info(
                `[@gjsify/nativescript-vite] detected @nativescript/vite@${major}.x — upstream handles ` +
                    'Vite 8 / Rolldown natively (rolldownOptions, string-only aliases, no @rollup/plugin-commonjs), ' +
                    'so the function-alias drop and commonjs strip are skipped; only the vite-side ' +
                    `"${TS_CHECK_PLUGIN}" type-check plugin is removed.`,
            );
        }
    } else {
        // Fix (1): drop function-replacement `resolve.alias` entries (Rolldown
        // rejects them). Only on the <= 2 / unknown line — 8.x ships string aliases.
        if (config.resolve?.alias) {
            out.resolve = { ...config.resolve, alias: dropFunctionAliases(config.resolve.alias) };
        }
        // Fix (2): remove the explicit `@rollup/plugin-commonjs` plugin (Rolldown
        // crashes on it). Only on the <= 2 / unknown line — 8.x has no such plugin.
        if (Array.isArray(config.plugins)) {
            const before = countPluginByName(config.plugins, 'commonjs');
            out.plugins = stripPluginByName(config.plugins, 'commonjs');
            // Observability: the strip depends on `@rollup/plugin-commonjs` registering
            // exactly `name: 'commonjs'` as a synchronous, top-level (or nested-array)
            // plugin object. If a future `@nativescript/vite` renames it or wraps it in
            // a Promise, the strip silently misses and Rolldown crashes again with the
            // `currentLoadingModule` error this package exists to prevent — so warn loud
            // when the plugin we expect to remove was NOT found.
            if (before === 0) {
                // one-time build-time diagnostic — surfaces a silent upstream rename
                console.warn(
                    '[@gjsify/nativescript-vite] no plugin named "commonjs" found in the upstream config — ' +
                        'if your @nativescript/vite version renamed/wrapped @rollup/plugin-commonjs, the Rolldown ' +
                        'CommonJS fix may not have applied.',
                );
            }
        }
    }

    // Fix (3): drop the vite-side `ns-typescript-check` plugin on EITHER line. A
    // bundler should bundle, not type-check — gjsify defers the authoritative
    // TypeScript gate to `gjsify tsc` / the app's own `check` script (the same
    // separation Vite's esbuild/SWC pipeline already makes). The vite-side check
    // additionally runs a SEPARATE program that loads the full `@nativescript/types`
    // android globals and, under TS 6+, fails the build on the *standard*
    // NativeScript `createNativeView(): android.view.View` override — a covariance
    // the app's own `tsc --noEmit` accepts. Removing it (not silencing it) keeps the
    // build honest; type errors surface in `gjsify tsc`, the real gate. No-op when
    // the plugin is absent (8.x may not register it).
    if (Array.isArray(out.plugins)) {
        const tsCheckBefore = countPluginByName(out.plugins, TS_CHECK_PLUGIN);
        out.plugins = stripPluginByName(out.plugins, TS_CHECK_PLUGIN);
        if (tsCheckBefore > 0) {
            console.warn(
                `[@gjsify/nativescript-vite] removed the vite-side "${TS_CHECK_PLUGIN}" plugin — gjsify defers ` +
                    "TypeScript checking to `gjsify tsc` / the app's own `check` script (the vite-side check fails " +
                    'the build on the standard NativeScript `createNativeView` override under TS 6+, which the ' +
                    "app's own tsc accepts). Run `gjsify tsc` for the authoritative type gate.",
            );
        }
    }

    return out;
}

/**
 * Keep only `resolve.alias` entries Vite 8 / Rolldown accepts. The array form
 * may carry function `replacement`s (Vite types `Alias.replacement` as `string`,
 * but `@nativescript/vite` sets functions at runtime — so this check is
 * LOAD-BEARING; do not remove it as "always true"). Malformed/holey entries are
 * skipped. The object/record form only ever holds strings, so it passes through.
 */
function dropFunctionAliases(alias: AliasOptions): AliasOptions {
    if (!Array.isArray(alias)) return alias;
    return (alias as Alias[]).filter(
        (entry) => entry != null && typeof (entry as { replacement?: unknown }).replacement !== 'function',
    );
}

/**
 * Remove every plugin with the given `name` from a (possibly nested) Vite
 * plugins array, preserving order and nesting of the rest. Assumes plugins are
 * synchronous objects (not `Promise<Plugin>`); `@nativescript/vite` registers
 * `@rollup/plugin-commonjs` synchronously, so this holds for the supported
 * versions.
 */
function stripPluginByName(plugins: UserConfig['plugins'], name: string): UserConfig['plugins'] {
    if (!Array.isArray(plugins)) return plugins;
    const out: NonNullable<UserConfig['plugins']> = [];
    for (const entry of plugins) {
        if (Array.isArray(entry)) {
            out.push(stripPluginByName(entry, name) as never);
        } else if (entry && typeof entry === 'object' && 'name' in entry && (entry as Plugin).name === name) {
            // dropped
        } else {
            out.push(entry as never);
        }
    }
    return out;
}

/** Count plugins with the given `name` across a (possibly nested) plugins array. */
function countPluginByName(plugins: UserConfig['plugins'], name: string): number {
    if (!Array.isArray(plugins)) return 0;
    let n = 0;
    for (const entry of plugins) {
        if (Array.isArray(entry)) n += countPluginByName(entry, name);
        else if (entry && typeof entry === 'object' && 'name' in entry && (entry as Plugin).name === name) n += 1;
    }
    return n;
}
