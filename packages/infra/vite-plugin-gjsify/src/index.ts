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

import { gjsImportsEmptyPlugin } from '@gjsify/rolldown-plugin-gjsify';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';
import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';

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
        configPlugin,
    ];
}

export default gjsifyBrowser;
