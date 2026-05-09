// Wrap `.css` imports as JS string default exports.
//
// Rolldown's experimental CSS bundling was removed (see
// https://github.com/rolldown/rolldown/issues/4271) — when the bundler
// sees a `.css` extension it errors out unless something else loads the
// file first. We hook into `load` (with a path filter) BEFORE Rolldown's
// CSS classification fires and emit a JS module whose default export is
// the CSS source as a string. Consumers can then do:
//
//   import css from './app.css';
//   provider.load_from_string(css);
//
// — the canonical pattern for `Gtk.CssProvider` under GJS.
//
// `@import` resolution + nesting/modern-syntax lowering are handled via
// lightningcss `bundleAsync`. The defaults work for the common case
// (resolve `@import`s, no targeting); the `--app gjs` orchestrator passes
// `targets: { firefox: 60 << 16 }` so nesting + modern selectors get
// flattened to GTK4-CSS-engine-compatible output. Targeting is opt-in —
// a missing `targets` keeps the source pristine.
//
// Backend selection (Phase D-2 decision matrix in
// `docs/poc/lightningcss-decision.md`):
//
//   1. `@gjsify/lightningcss-native` when its prebuild is loadable on
//      the running architecture (3-5× faster than the WASM track,
//      ~960× faster cold init). Only relevant when `gjsify build`
//      itself runs under GJS (Phase D-3).
//   2. npm `lightningcss` for everything else (Node, unsupported
//      arches, dev machines without the prebuild). Existing behavior;
//      keeps the regular dependency on this package.
//
// Selection is lazy and silent — the first `.css` load probes for
// the native bridge once, caches the answer, and routes the rest of
// the build through the chosen backend. Set the env var
// `GJSIFY_CSS_BACKEND={native|npm}` to force a specific backend
// (mainly useful for benchmarking + the integration suite).

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'rolldown';

export interface CssAsStringOptions {
    /**
     * lightningcss browser targets passed to `bundleAsync`. When set,
     * nesting + modern syntax are lowered for the given engines. The
     * GJS orchestrator defaults this to `{ firefox: 60 << 16 }` to
     * match the GTK4 CSS parser. Omit or leave undefined to skip
     * lowering (output stays as-authored except for `@import` inlining).
     */
    targets?: import('lightningcss').Targets;
    /**
     * When true (default), `@import` statements are resolved by
     * lightningcss `bundleAsync`. Set false to fall back to a plain
     * `readFile` — useful only when you want to keep `@import` strings
     * verbatim in the bundled JS (rare).
     */
    bundle?: boolean;
}

interface BundleResult {
    code: Uint8Array;
}

type Bundler = (filename: string, targets: import('lightningcss').Targets | undefined) => Promise<BundleResult>;

let _bundlerPromise: Promise<Bundler> | null = null;

async function pickBundler(): Promise<Bundler> {
    const forced = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GJSIFY_CSS_BACKEND;

    if (forced === 'npm') return loadNpmBundler();
    if (forced === 'native') {
        const native = await tryLoadNativeBundler();
        if (!native) throw new Error('GJSIFY_CSS_BACKEND=native but @gjsify/lightningcss-native is not loadable');
        return native;
    }

    const native = await tryLoadNativeBundler();
    return native ?? loadNpmBundler();
}

// Local mirror of the @gjsify/lightningcss-native surface we touch. We
// can't rely on the published types here because the package is an
// OPTIONAL peer dep — under Node it's not installed, so `import type`
// from it would break tsc on every Node consumer. Local interface
// keeps the type narrow + decouples the plugin's typecheck from
// whether the prebuild package is installed.
interface NativeLightningcssSurface {
    hasNativeLightningcss(): boolean;
    bundle(input: {
        filename: string;
        targets?: string;
        minify?: boolean;
        sourceMap?: boolean;
        errorRecovery?: boolean;
    }): { code: Uint8Array; map?: Uint8Array };
}

async function tryLoadNativeBundler(): Promise<Bundler | null> {
    // The native bridge only exists under GJS — `imports.gi` marker. Skip
    // the dynamic import entirely on Node so it doesn't even register as a
    // resolved dep, which would inflate the CLI's bundled output.
    const isGjs = typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';
    if (!isGjs) return null;

    try {
        // Indirect specifier so tsc + Rolldown don't try to resolve the
        // optional peer dep at build time. Resolution happens only at
        // runtime under GJS (where the prebuild is installed).
        const specifier = '@gjsify/lightningcss-native';
        const mod = (await import(/* @vite-ignore */ specifier)) as NativeLightningcssSurface;
        if (!mod.hasNativeLightningcss()) return null;
        return async (filename, targets) => {
            // The native shim accepts a browserslist string; the npm
            // `lightningcss` Targets struct is bitfield-encoded
            // (`firefox: 60 << 16` etc). Convert by extracting major
            // version per browser key and re-emitting as the equivalent
            // browserslist query.
            const query = targetsToBrowserslist(targets);
            return mod.bundle({
                filename,
                targets: query,
                minify: false,
                sourceMap: false,
                errorRecovery: true,
            });
        };
    } catch {
        return null;
    }
}

async function loadNpmBundler(): Promise<Bundler> {
    const { bundleAsync } = await import('lightningcss');
    return async (filename, targets) => {
        const result = await bundleAsync({
            filename,
            targets,
            minify: false,
            errorRecovery: true,
        });
        return { code: result.code };
    };
}

function targetsToBrowserslist(
    targets: import('lightningcss').Targets | undefined,
): string | undefined {
    if (!targets) return undefined;
    const parts: string[] = [];
    for (const [browser, encoded] of Object.entries(targets) as [string, number | undefined][]) {
        if (typeof encoded !== 'number') continue;
        // npm lightningcss encodes versions as `(major << 16) | (minor << 8) | patch`.
        const major = (encoded >>> 16) & 0xff;
        if (major === 0) continue;
        const name = browser === 'ios_saf' ? 'ios' : browser;
        parts.push(`${name} >= ${major}`);
    }
    return parts.length ? parts.join(', ') : undefined;
}

export function cssAsStringPlugin(options: CssAsStringOptions = {}): Plugin {
    const { targets, bundle = true } = options;
    return {
        name: 'gjsify-css-as-string',
        load: {
            filter: { id: /\.css$/ },
            async handler(id: string) {
                const code = bundle
                    ? new TextDecoder('utf-8').decode(await loadAndBundleCss(id, targets))
                    : await readFile(id, 'utf8');
                return {
                    code: `export default ${JSON.stringify(code)};`,
                    moduleType: 'js' as const,
                };
            },
        },
    };
}

async function loadAndBundleCss(
    filename: string,
    targets: import('lightningcss').Targets | undefined,
): Promise<Uint8Array> {
    if (!_bundlerPromise) _bundlerPromise = pickBundler();
    const bundler = await _bundlerPromise;
    const { code } = await bundler(filename, targets);
    return code;
}
