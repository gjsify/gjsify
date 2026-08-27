// `@gjsify/vite-plugin-gjsify` — the "Vite-plugin track".
//
// This preset makes a web app's DEV experience (Vite dev server + HMR) and its
// Vite-driven `vite build` output match what `gjsify build --app browser`
// produces. It mirrors the Rolldown browser-target composition in
// `@gjsify/rolldown-plugin-gjsify`'s `app/browser.ts` so dual-target apps
// (the `examples/dom/*` shape, showcases' browser builds) get gjsify's browser
// transforms while still developing under Vite.
//
// What it composes (one-to-one with `--app browser`, EXCEPT css-as-string):
//   - gjsImportsEmptyPlugin()  → resolve `@girs/*` / `gi://*` to an empty
//                                module (GJS-only specifiers leak transitively
//                                via `@gjsify/unit` etc.; no browser equivalent)
//   - blueprintPlugin()        → compile `.blp` GNOME Blueprint files to XML
//   - deepkitPlugin()          → optional Deepkit type reflection (opt-in)
//   - an inline Vite config hook supplying the browser-target resolve aliases,
//     conditions, mainFields, defines and build target.
//
// DELIBERATELY OMITTED: cssAsStringPlugin.
//   In `--app browser` (GJS/GTK builds) CSS is inlined into the JS bundle as a
//   string because GTK consumes CSS as a string passed to its CSS provider.
//   A *real* browser web app under Vite wants CSS to flow through Vite's NATIVE
//   CSS pipeline (HMR, `<link>` extraction, PostCSS/Lightning CSS, CSS modules).
//   Turning every `import './x.css'` into a JS string here would break that.
//   css-as-string is a GJS/GTK build concern only, so this preset = Vite-dev
//   parity with `gjsify build --app browser`, MINUS css-as-string.
//
// `aliasPlugin` from rolldown-plugin-gjsify is intentionally NOT used here
// (it is not part of that package's public API). Vite has a native
// `resolve.alias`, which is what the inline config hook below sets.

import { type Plugin } from 'vite';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';

import {
    gjsImportsEmptyPlugin,
    platformResolvePlugin,
    nativescriptSuffixChain,
    detectNativescriptPlatform,
    nativescriptPlatformDefines,
    cssAsStringPlugin,
} from '@gjsify/rolldown-plugin-gjsify';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';
import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import { ALIASES_NODE_FOR_NATIVESCRIPT } from '@gjsify/resolve-npm';

export interface GjsifyBrowserOptions {
    /**
     * Enable Deepkit type reflection (`@deepkit/type` runtime types). Off by
     * default — the type compiler stays uninstalled until opted in, matching
     * the lazy-loading contract of `@gjsify/rolldown-plugin-deepkit`.
     */
    reflection?: boolean;
    /**
     * Extra `resolve.alias` entries merged on top of the gjsify browser
     * polyfill aliases (`process` / `assert` → `@gjsify/empty` / `@gjsify/assert`).
     * User entries win over the defaults.
     */
    aliases?: Record<string, string>;
    /**
     * Extra package names to add to Vite's `optimizeDeps.exclude`, so Vite's
     * esbuild dependency pre-bundler doesn't try to crawl GJS-shaped deps that
     * import `gi://` / `@girs/*` (esbuild can't resolve those). `@gjsify/unit`
     * is always excluded.
     */
    optimizeDepsExclude?: string[];
    /**
     * Resolve `.css` imports to their CSS **string** (default export) instead of
     * routing them through Vite's native CSS pipeline (auto-injected `<link>` /
     * HMR). OFF by default — a browser-native app wants Vite's pipeline.
     *
     * Turn this ON to UNIFY styling with the native (`--app gjs`) target, where
     * CSS is authored in real `.css` files and consumed as a string
     * (`import css from './x.css'` → `Gtk.CssProvider.load_from_string(css)`).
     * With it on, `gjsify build --app browser` (which always applies
     * css-as-string) and this Vite dev preset agree: `import css from './x.css'`
     * yields the identical CSS string on BOTH, so a cross-platform app can share
     * one authoring pattern (real `.css` file + import-as-string + a per-target
     * apply step: `Gtk.CssProvider` on GJS, a `<style>` element on the browser).
     * The app owns injection, mirroring how `@gjsify/adwaita-web` self-injects
     * its skin. Trades away Vite CSS HMR / `<link>` extraction for that parity.
     */
    cssAsString?: boolean;
}

/**
 * Returns the Vite plugin array that brings `gjsify build --app browser`'s
 * browser-target transforms to a Vite project (dev + build), minus
 * css-as-string. Spread it into a Vite config's `plugins`:
 *
 * ```ts
 * import { defineConfig } from 'vite';
 * import { gjsifyBrowser } from '@gjsify/vite-plugin-gjsify';
 *
 * export default defineConfig({
 *   plugins: [...gjsifyBrowser()],
 * });
 * ```
 */
export function gjsifyBrowser(options: GjsifyBrowserOptions = {}): Plugin[] {
    // Standard Node → browser polyfill aliases. `@gjsify/unit` imports
    // `node:assert` at the top level and references `process` inside an
    // unreachable (browser) try/catch that the bundler still resolves
    // statically — map both so the browser bundle stays resolvable.
    const browserPolyfillAliases: Record<string, string> = {
        process: '@gjsify/empty',
        'node:process': '@gjsify/empty',
        assert: '@gjsify/assert',
        'node:assert': '@gjsify/assert',
    };

    const alias: Record<string, string> = {
        ...browserPolyfillAliases,
        ...options.aliases,
    };

    const optimizeDepsExclude = ['@gjsify/unit', ...(options.optimizeDepsExclude ?? [])];

    const configPlugin: Plugin = {
        name: 'gjsify-browser-config',
        config() {
            return {
                resolve: {
                    alias,
                    // Match `--app browser`'s `conditionNames` / `mainFields`
                    // so package `exports` / `browser` fields resolve the same
                    // way under Vite as they do under the Rolldown CLI.
                    conditions: ['import', 'browser'],
                    mainFields: ['browser', 'module', 'main'],
                },
                define: {
                    global: 'globalThis',
                    window: 'globalThis',
                },
                build: {
                    target: 'esnext',
                },
                optimizeDeps: {
                    // Vite's esbuild pre-bundler crawls deps eagerly and chokes
                    // on `gi://` / `@girs/*` imports in GJS-shaped packages.
                    // Excluding them defers resolution to the plugin pipeline,
                    // where gjsImportsEmptyPlugin handles the GJS specifiers.
                    exclude: optimizeDepsExclude,
                },
            };
        },
    };

    return [
        gjsImportsEmptyPlugin() as unknown as Plugin,
        blueprintPlugin(),
        deepkitPlugin({ reflection: options.reflection }) as unknown as Plugin,
        // Opt-in: mirror `--app browser`'s css-as-string so `import css from
        // './x.css'` yields the CSS string in dev too (unify with the native
        // `--app gjs` target). `enforce: 'pre'` so this `load` fires before
        // Vite's built-in CSS transform claims the `.css` id.
        ...(options.cssAsString ? [{ ...(cssAsStringPlugin() as unknown as Plugin), enforce: 'pre' as const }] : []),
        configPlugin,
    ];
}

export default gjsifyBrowser;

// ---------------------------------------------------------------------------
// `gjsifyNativescript()` — Vite-plugin-track for `--app nativescript`
// ---------------------------------------------------------------------------
//
// Schwesterstück zu `gjsifyBrowser()`: produces a Vite plugin array that
// makes a NativeScript app's Vite build (NS 9.0+ ships @nativescript/vite)
// match what `gjsify build --app nativescript` produces under Rolldown.
//
// What it composes (one-to-one with `--app nativescript`):
//   - gjsImportsEmptyPlugin() → resolve `@girs/*` / `gi://*` to empty
//   - deepkitPlugin() → optional Deepkit reflection (opt-in)
//   - inline Vite `config` hook setting NS-target aliases, conditions,
//     mainFields, defines, build target.
//
// DELIBERATELY OMITTED (compared to `gjsifyBrowser()`):
//   - blueprintPlugin (Blueprint is a GTK-specific UI DSL; NS uses XML/Vue/
//     React/Svelte UI bindings instead)
//   - cssAsStringPlugin (NS ships its own CSS pipeline via @nativescript/core;
//     .css imports flow through the consuming @nativescript/vite build)
//   - `window` define (NS apps have no DOM and use `typeof window === undefined`
//     as a cross-platform branch gate)

export interface GjsifyNativescriptOptions {
    /**
     * Enable Deepkit type reflection. Off by default — matches gjsifyBrowser.
     */
    reflection?: boolean;
    /**
     * Extra `resolve.alias` entries merged on top of `ALIASES_NODE_FOR_NATIVESCRIPT`.
     * User entries win over the defaults.
     */
    aliases?: Record<string, string>;
    /**
     * Extra package names to add to Vite's `optimizeDeps.exclude`. `@gjsify/unit`
     * is always excluded.
     */
    optimizeDepsExclude?: string[];
}

/**
 * `@nativescript/core`'s CSS parser pulls in `css-tree`, whose data modules
 * (`data.js` / `data-patch.js` / `version.js`) load JSON via
 * `createRequire(import.meta.url)('mdn-data/*.json' | '../package.json')` at
 * module-evaluation time. Rolldown can't statically resolve those dynamic
 * requires, so they survive into the bundle and throw on the NativeScript V8
 * runtime ("Module evaluation promise rejected") — crashing every NS app that
 * uses `@nativescript/core`'s styling. css-tree ships a self-contained
 * `dist/csstree.esm.js` with the data inlined (no `createRequire`); aliasing the
 * bare `css-tree` specifier to it keeps those requires out of the bundle.
 *
 * Resolved from the consuming project (`css-tree` is `@nativescript/core`'s
 * transitive dep, not a direct one here). Returns no alias when css-tree isn't
 * installed — a non-NS-core consumer keeps resolving `css-tree` normally.
 */
function nativescriptCssTreeAlias(fromDir: string): Record<string, string> {
    try {
        const require = createRequire(import.meta.url);
        return { 'css-tree': require.resolve('css-tree/dist/csstree.esm', { paths: [fromDir] }) };
    } catch {
        return {};
    }
}

/** A barrel module referenced from XML via an `xmlns` namespace. */
interface XmlnsBarrel {
    /** The NativeScript module nickname, e.g. `widgets/index` (what `loadModule` looks up). */
    name: string;
    /** Root-relative POSIX import specifier Vite resolves, e.g. `/app/widgets/index.ts`. */
    spec: string;
}

/**
 * Collect the barrel modules referenced from the app's XML via `xmlns="~/MOD"`
 * that `@nativescript/vite`'s `ns-bundler-context` does NOT register — i.e. those
 * with no paired `.xml` sibling. Returns the NS nickname + a root-relative import
 * specifier for each.
 */
function collectXmlnsBarrels(appDir: string, root: string): XmlnsBarrel[] {
    const xmlFiles: string[] = [];
    const walk = (dir: string): void => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = nodePath.join(dir, entry);
            let isDir: boolean;
            try {
                isDir = statSync(full).isDirectory();
            } catch {
                continue;
            }
            if (isDir) walk(full);
            else if (full.endsWith('.xml')) xmlFiles.push(full);
        }
    };
    walk(appDir);

    const names = new Set<string>();
    const xmlnsRe = /xmlns:[\w-]+\s*=\s*["']~\/([^"']+)["']/g;
    for (const file of xmlFiles) {
        let src: string;
        try {
            src = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const match of src.matchAll(xmlnsRe)) {
            names.add(match[1].replace(/\/+$/, ''));
        }
    }

    const barrels: XmlnsBarrel[] = [];
    for (const name of names) {
        // ns-bundler-context already registers any module that has an `.xml` sibling.
        if (existsSync(nodePath.join(appDir, `${name}.xml`))) continue;
        const file = ['.ts', '.js', '/index.ts', '/index.js']
            .map((suffix) => nodePath.join(appDir, `${name}${suffix}`))
            .find((candidate) => existsSync(candidate));
        if (!file) continue;
        const spec = '/' + nodePath.relative(root, file).split(nodePath.sep).join('/');
        barrels.push({ name, spec });
    }
    return barrels;
}

/**
 * Register barrel modules referenced from XML via `xmlns` namespaces, which
 * `@nativescript/vite`'s `ns-bundler-context` leaves unregistered.
 *
 * NativeScript resolves a custom element — e.g. `<w:SourceView>` declared with
 * `xmlns:w="~/widgets/index"` — at runtime via `global.loadModule("widgets/index")`,
 * a lookup in the registry populated by `registerModule` / `registerBundlerModules`.
 * `ns-bundler-context` registers every XML file, its paired code-behind and CSS,
 * but deliberately NOT standalone barrels (`index.ts` with no `.xml` sibling). So a
 * barrel reachable only via `xmlns` (`~/widgets/index`, `~/mdx/index`) is never
 * registered; an ESM bundle has no `global.require` fallback, so `loadModule(...)`
 * returns `null` → "Module 'SourceView' not found". `@nativescript/webpack`'s
 * `xml-namespace-loader` registered every `.ts`, so these resolved for free there —
 * this plugin reproduces that behaviour for the Vite build.
 *
 * It augments `@nativescript/vite`'s generated `virtual:ns-bundler-context` module
 * (guaranteed imported early, before `Application.run`) by prepending a namespace
 * import of each missing barrel and appending matching `registerModule` calls. The
 * barrels enter the bundle via the added imports; registration runs right after the
 * upstream `registerBundlerModules`.
 */
function nativescriptXmlnsBarrelsPlugin(): Plugin {
    const BUNDLER_CONTEXT_ID = '\0virtual:ns-bundler-context';
    let root = process.cwd();
    let appDir: string | undefined;
    return {
        name: 'gjsify-nativescript-xmlns-barrels',
        configResolved(config) {
            root = config.root || process.cwd();
            // `~/` maps to the NativeScript app directory (`appPath`, default `app`;
            // `src` is the other common layout). Probe both; XML lives under it.
            appDir = ['app', 'src'].map((dir) => nodePath.join(root, dir)).find((dir) => existsSync(dir));
        },
        transform(code, id) {
            if (id !== BUNDLER_CONTEXT_ID || !appDir) return null;
            const barrels = collectXmlnsBarrels(appDir, root);
            if (barrels.length === 0) return null;
            const imports = barrels
                .map((barrel, i) => `import * as __gjsifyXmlnsBarrel${i} from ${JSON.stringify(barrel.spec)};`)
                .join('\n');
            const registrations = barrels
                .map(
                    (barrel, i) =>
                        `    global.registerModule(${JSON.stringify(barrel.name)}, () => __gjsifyXmlnsBarrel${i});`,
                )
                .join('\n');
            const footer = [
                '',
                ';(function () {',
                '  try {',
                "    if (typeof global !== 'undefined' && typeof global.registerModule === 'function') {",
                registrations,
                '    }',
                '  } catch (e) {',
                "    try { console.warn('[gjsify-nativescript] xmlns barrel registration failed', e); } catch (_) {}",
                '  }',
                '})();',
                '',
            ].join('\n');
            return { code: `${imports}\n${code}${footer}`, map: null };
        },
    };
}

/**
 * Returns the Vite plugin array that brings `gjsify build --app nativescript`'s
 * NS-target transforms to a Vite project (dev + build). Spread it into a
 * Vite config's `plugins`:
 *
 * ```ts
 * import { defineConfig } from 'vite';
 * import { gjsifyNativescript } from '@gjsify/vite-plugin-gjsify';
 * import nativescript from '@nativescript/vite';
 *
 * export default defineConfig({
 *   plugins: [nativescript(), ...gjsifyNativescript()],
 * });
 * ```
 */
export function gjsifyNativescript(options: GjsifyNativescriptOptions = {}): Plugin[] {
    // Bare Node-builtin + node:* prefix aliases. Both forms route to the same
    // `@gjsify/<X>` target. Generated from `ALIASES_NODE_FOR_NATIVESCRIPT` so
    // the single source-of-truth in `@gjsify/resolve-npm` drives every build,
    // matching the Rolldown-side `app/nativescript.ts` composition.
    const nodePrefixAliases: Record<string, string> = {};
    for (const [bare, target] of Object.entries(ALIASES_NODE_FOR_NATIVESCRIPT)) {
        nodePrefixAliases[bare] = target;
        nodePrefixAliases[`node:${bare}`] = target;
    }

    const optimizeDepsExclude = ['@gjsify/unit', ...(options.optimizeDepsExclude ?? [])];

    // Target platform from the env NS' CLI sets when it spawns the bundler
    // (else `undefined` → `.native`-only resolution + neutral defines).
    const platform = detectNativescriptPlatform();

    const configPlugin: Plugin = {
        name: 'gjsify-nativescript-config',
        config(userConfig, env) {
            // `__DEV__` tracks Vite's mode (dev server vs `vite build`).
            const dev = env?.mode !== 'production';
            // Resolve css-tree from the project root (its dist is the consumer's
            // transitive dep). User `aliases` are merged last so they win.
            const root = userConfig?.root ?? process.cwd();
            return {
                resolve: {
                    alias: { ...nodePrefixAliases, ...nativescriptCssTreeAlias(root), ...options.aliases },
                    conditions: ['import', 'nativescript'],
                    mainFields: ['nativescript', 'module', 'main'],
                },
                define: {
                    global: 'globalThis',
                    // NO `window` define — NS apps have no DOM
                    //
                    // Standard NS compile-time platform flags, matching the
                    // Rolldown `--app nativescript` factory + the globals
                    // `@nativescript/vite` seeds in its main entry.
                    ...nativescriptPlatformDefines(platform, { dev }),
                },
                build: {
                    target: 'esnext',
                },
                optimizeDeps: {
                    exclude: optimizeDepsExclude,
                },
            };
        },
    };

    return [
        gjsImportsEmptyPlugin() as unknown as Plugin,
        // Platform-specific source variants (`*.android` / `*.ios` /
        // `*.native`). A `resolveId` HOOK, NOT a `resolve.alias` — so it works
        // under Vite 8 / Rolldown, where @nativescript/vite's function-based
        // alias for the same feature is rejected.
        platformResolvePlugin({ suffixes: nativescriptSuffixChain(platform) }) as unknown as Plugin,
        // Register `xmlns`-referenced barrel modules that @nativescript/vite's
        // ns-bundler-context leaves unregistered (its tree-shaking gap for
        // barrels with no `.xml` sibling). Reproduces webpack's xml-namespace-loader.
        nativescriptXmlnsBarrelsPlugin(),
        // NO blueprintPlugin — Blueprint is GTK-specific
        // NO cssAsStringPlugin — NS handles CSS via @nativescript/core
        deepkitPlugin({ reflection: options.reflection }) as unknown as Plugin,
        configPlugin,
    ];
}
