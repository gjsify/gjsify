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
// `@import` resolution + nesting/modern-syntax lowering. On the npm backend
// both happen in one lightningcss `bundleAsync` call. On the native backend
// `@import`s are resolved + inlined in JS first (`flattenCssImports`, so bare
// node_modules specifiers work — the native `bundle()` FileProvider can't walk
// node_modules), then the flattened CSS goes through the native `transform()`
// for lowering. Both use the same `cssBundleResolver`. The `--app gjs`
// orchestrator passes `targets: { firefox: 60 << 16 }` so nesting + modern
// selectors get flattened to GTK4-CSS-engine-compatible output. Targeting is
// opt-in — a missing `targets` keeps the source pristine.
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
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'rolldown';
import type { Targets } from 'lightningcss';
import { isGjs } from '../utils/runtime.js';

export interface CssAsStringOptions {
    /**
     * lightningcss browser targets passed to `bundleAsync`. When set,
     * nesting + modern syntax are lowered for the given engines. The
     * GJS orchestrator defaults this to `{ firefox: 60 << 16 }` to
     * match the GTK4 CSS parser. Omit or leave undefined to skip
     * lowering (output stays as-authored except for `@import` inlining).
     */
    targets?: Targets;
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

type Bundler = (filename: string, targets: Targets | undefined) => Promise<BundleResult>;

let _bundlerPromise: Promise<Bundler> | null = null;

async function pickBundler(): Promise<Bundler> {
    const forced = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
        ?.GJSIFY_CSS_BACKEND;

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
    transform(input: {
        filename?: string;
        code: Uint8Array | string;
        targets?: string;
        minify?: boolean;
        sourceMap?: boolean;
    }): { code: Uint8Array; map?: Uint8Array };
}

async function tryLoadNativeBundler(): Promise<Bundler | null> {
    // The native bridge only exists under GJS — `imports.gi` marker. Skip
    // the dynamic import entirely on Node so it doesn't even register as a
    // resolved dep, which would inflate the CLI's bundled output.
    if (!isGjs()) return null;

    try {
        // Indirect specifier so tsc + Rolldown don't try to resolve the
        // optional peer dep at build time. Resolution happens only at
        // runtime under GJS (where the prebuild is installed).
        const specifier = '@gjsify/lightningcss-native';
        // GJS's native ESM loader has NO node_modules resolver, so a BARE
        // `import('@gjsify/lightningcss-native')` throws "Module not found"
        // under GJS — which is exactly the runtime this native path is for.
        // Resolve the bare specifier to a concrete file path first (anchored
        // at the bundle's own location), then import the resulting file:// URL
        // — mirroring how `bundler-pick.ts` loads `@gjsify/rolldown-native`.
        const resolved = createRequire(import.meta.url).resolve(specifier);
        const mod = (await import(/* @vite-ignore */ pathToFileURL(resolved).href)) as NativeLightningcssSurface;
        if (!mod.hasNativeLightningcss()) return null;
        return async (filename, targets) => {
            // The native `@gjsify/lightningcss-native` `bundle()` resolves
            // `@import` chains through lightningcss's filesystem-backed
            // FileProvider, which walks relative + absolute paths but NOT
            // bare node_modules specifiers (`@import "@scope/pkg/x.css"`) —
            // a JS resolver callback can't cross the GI/Rust boundary. So we
            // do `@import` resolution in JS first, using the SAME
            // `cssBundleResolver` the npm `bundleAsync` path uses (npm-package
            // + `exports`-map aware), and hand the fully-flattened CSS to the
            // native `transform()` for the GTK4 nesting/modern-syntax lowering
            // (`targets`). The native shim accepts a browserslist string; the
            // npm `lightningcss` Targets struct is bitfield-encoded
            // (`firefox: 60 << 16` etc), so convert per browser key.
            let flattened: string;
            try {
                flattened = await flattenCssImports(filename);
            } catch (err) {
                // The native rolldown engine flattens a thrown plugin error to
                // a generic "plugin `gjsify-css-as-string` threw an error"
                // diagnostic — the JS message is lost across the GI boundary.
                // Surface the actionable reason (which file, which @import) on
                // stderr before re-throwing so a bad/missing @import is not an
                // opaque build failure.
                console.error(`[gjsify-css-as-string] ${(err as Error).message}`);
                throw err;
            }
            const query = targetsToBrowserslist(targets);
            return mod.transform({
                filename,
                code: flattened,
                targets: query,
                minify: false,
                sourceMap: false,
            });
        };
    } catch {
        return null;
    }
}

async function loadNpmBundler(): Promise<Bundler> {
    // INDIRECT specifier, for the same reason `tryLoadNativeBundler` uses one:
    // keep this acquisition out of the BUILD graph so it is resolved at
    // runtime only. npm `lightningcss` is a napi-rs package, and a static
    // `import('lightningcss')` here put its generated loader into the module
    // graph of every `--app gjs` bundle — including the CLI's own committed
    // `dist/cli.gjs.mjs`.
    //
    // That is what made the committed bundle ENVIRONMENT-DEPENDENT. With
    // `@gjsify/napi` resolvable, `napiNodeAddonPlugin` rewrites the loader to a
    // `loadAddon()` shim and inlines it; without it the plugin declines and the
    // import stays external. Two different module graphs, so the minifier
    // assigns different variable names, so the artifact stops reproducing from
    // its own source (`verify-committed-bundles` red, first difference at byte
    // 275: `r=` vs `a=` for `globalThis.imports.gi.GLib`). A toolchain artifact
    // must not depend on whether an optional package happened to be installed
    // when it was built.
    //
    // Nothing is lost under GJS: the documented GJS backend is
    // `@gjsify/lightningcss-native` (above), and this npm fallback was never
    // actually usable there — its `.node` cannot load under GJS without a
    // build-time rewrite, and the only arches where that rewrite is possible
    // (`@gjsify/napi`: linux-x64, darwin-arm64) are arches where the native
    // bridge exists anyway. On Node this is unchanged: `lightningcss` is a real
    // `dependency` of this package, so the runtime resolve finds it.
    const specifier = 'lightningcss';
    const { bundleAsync } = (await import(/* @vite-ignore */ specifier)) as typeof import('lightningcss');
    return async (filename, targets) => {
        const result = await bundleAsync({
            filename,
            targets,
            minify: false,
            errorRecovery: true,
            resolver: cssBundleResolver,
        });
        return { code: result.code };
    };
}

// lightningcss `bundleAsync` resolver — adds npm-package-specifier support
// to `@import` statements. Without a resolver, lightningcss only walks
// relative + absolute paths; bare package specifiers (`@scope/pkg/file.css`
// or `pkg-name/file.css`) hit ENOENT.
//
// This restores the @import-from-node_modules behavior that the old
// `@gjsify/esbuild-plugin-css` shipped with — needed by every consumer
// monorepo that puts shared CSS in a workspace package (e.g.
// pixel-rpg/map-editor's `@import "@pixelrpg/gjs/index.css"`).
//
// Algorithm mirrors Node's standard module-resolution algorithm so that
// `exports` maps in the target package.json are honored (e.g.
// `@pixelrpg/gjs` exposes `./index.css` via its exports field — that
// must resolve through `package.json#exports`, not a direct file probe).
// A `url()`/asset reference (a `@font-face { src: url('x.woff2') }`, a
// `background: url('img.png')`, a `data:`/`http:` URL) is NOT a bundle-able
// CSS module — it is served by the consumer at runtime. lightningcss keeps
// `url()` verbatim by default, but a bare-specifier asset reference routed
// through the resolver (a future lightningcss version, or the native Rust
// `Bundler`) would otherwise hit `req.resolve()` and throw `Cannot find
// module`, aborting the ENTIRE CSS build over a font/image the bundler was
// never meant to resolve. This predicate lets the resolver leave such
// references as-authored so the fonts still load at runtime.
const ASSET_REF_RE = /\.(woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico)(\?|#|$)/i;

function isAssetReference(specifier: string): boolean {
    return /^(data|https?|file):/i.test(specifier) || ASSET_REF_RE.test(specifier);
}

const cssBundleResolver = {
    resolve(specifier: string, from: string): string {
        if (isAbsolute(specifier)) return specifier;
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            return resolvePath(dirname(from), specifier);
        }
        // Bare specifier — walk node_modules and honor package.json exports.
        // `createRequire` takes a file URL or path; passing the importer
        // lets it scope its node_modules walk to the right starting point.
        const req = createRequire(pathToFileURL(from).href);
        try {
            return req.resolve(specifier);
        } catch (err) {
            // Not an installed module. If it's a `url()`/asset reference,
            // leave it verbatim so lightningcss keeps the `@font-face` /
            // `url()` rule intact (the consumer serves the asset) instead of
            // crashing the build. A genuine unresolvable CSS `@import`
            // re-throws with actionable context so the missing dependency
            // surfaces clearly on both backends (npm and native).
            if (isAssetReference(specifier)) return specifier;
            throw new Error(
                `cannot resolve @import "${specifier}" from ${from} (${(err as Error).message}). ` +
                    'If it is a workspace/npm package, ensure it is installed and exposes the CSS ' +
                    'file via its package.json "exports".',
            );
        }
    },
};

// Matches a CSS `@import` at-rule and captures the specifier + any trailing
// condition tokens (media query / `layer()` / `supports()`) before the `;`.
// Covers `@import "x";`, `@import 'x';`, and `@import url("x")` / `url(x)`.
const IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/g;

/** `String.prototype.replace` with an async replacer (sequential, order-preserving). */
async function replaceAllAsync(
    source: string,
    re: RegExp,
    fn: (match: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
    const matches = [...source.matchAll(re)];
    if (matches.length === 0) return source;
    let out = '';
    let last = 0;
    for (const m of matches) {
        const index = m.index ?? 0;
        out += source.slice(last, index);
        out += await fn(m[0], ...m.slice(1));
        last = index + m[0].length;
    }
    out += source.slice(last);
    return out;
}

/**
 * Recursively resolve + inline every bundleable `@import` in `entry`, using the
 * same {@link cssBundleResolver} the npm `bundleAsync` path uses. Returns a
 * single flattened CSS string with no bundleable `@import` statements left — the
 * native `transform()` then applies GTK4 nesting/target lowering.
 *
 * This is the GJS-native counterpart of the npm `lightningcss` `bundleAsync`
 * `@import` resolution: the native `bundle()` can only follow relative/absolute
 * paths (lightningcss's filesystem FileProvider), so this closes the bare
 * node_modules specifier gap (`@import "@scope/pkg/x.css"`) — the shared-CSS
 * package pattern every consumer monorepo uses — without a Rust-side resolver
 * hook. Asset-reference `@import`s (a bare `.woff2`/`.png`, a `data:`/`http:`
 * URL) are kept verbatim (the resolver leaves them alone), matching the npm
 * path. A cycle inlines each file at most once.
 */
async function flattenCssImports(entry: string): Promise<string> {
    const seen = new Set<string>();
    const inline = async (file: string, isRoot: boolean): Promise<string> => {
        const abs = isAbsolute(file) ? file : resolvePath(file);
        if (seen.has(abs)) return ''; // @import cycle — inline once
        seen.add(abs);
        let source = await readFile(abs, 'utf8');
        // `@charset` is only valid as the very first token of a stylesheet;
        // an inlined sub-file's `@charset` mid-stream would be invalid CSS.
        if (!isRoot) source = source.replace(/@charset[^;]*;/gi, '');
        return replaceAllAsync(source, IMPORT_RE, async (match, spec, condition) => {
            const resolved = cssBundleResolver.resolve(spec, abs);
            // Asset-reference `@import` (rare): resolver returns it verbatim —
            // keep the at-rule intact.
            if (resolved === spec) return match;
            const cond = condition?.trim();
            if (cond) {
                // Conditional `@import`s (`@import "x" screen`) wrap the inlined
                // content per lightningcss semantics. `layer()`/`supports()`
                // conditions have richer nesting rules we don't model — fail
                // loudly rather than emit subtly-wrong CSS.
                if (/\b(layer|supports)\s*\(/i.test(cond)) {
                    throw new Error(
                        `@import "${spec}" in ${abs} uses a layer()/supports() condition, which the ` +
                            'GJS-native CSS backend does not support. Inline the import manually or drop the condition.',
                    );
                }
                return `@media ${cond} {\n${await inline(resolved, false)}\n}`;
            }
            return inline(resolved, false);
        });
    };
    return inline(entry, true);
}

function targetsToBrowserslist(targets: Targets | undefined): string | undefined {
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
            // Also match `.scss`/`.sass` — a Sass entry is compiled to flat CSS
            // first (Sass already resolves its own `@use`/`@import`/partials and
            // flattens nesting, so no further lightningcss lowering is needed).
            filter: { id: /\.(css|s[ac]ss)$/ },
            async handler(id: string) {
                let code: string;
                if (/\.s[ac]ss$/.test(id)) {
                    code = await compileSass(id);
                } else {
                    code = bundle
                        ? new TextDecoder('utf-8').decode(await loadAndBundleCss(id, targets))
                        : await readFile(id, 'utf8');
                }
                return {
                    code: `export default ${JSON.stringify(code)};`,
                    moduleType: 'js' as const,
                };
            },
        },
    };
}

// Local mirror of the `sass` surface we touch — narrow to keep the plugin's
// typecheck independent of whether `sass`'s types are installed on a given
// consumer (it is lazy-loaded, only when a `.scss`/`.sass` file is imported).
interface SassSurface {
    compile(path: string, options?: { style?: 'expanded' | 'compressed' }): { css: string };
}

let _sassPromise: Promise<SassSurface> | null = null;

async function compileSass(filename: string): Promise<string> {
    if (!_sassPromise) {
        // Lazy + indirect specifier so `sass` is only resolved when a Sass file
        // is actually imported (mirrors the lazy lightningcss backend). The
        // `dart-sass` JS API is pure JS, so it loads under GJS + Node alike.
        _sassPromise = import(/* @vite-ignore */ 'sass') as unknown as Promise<SassSurface>;
    }
    try {
        const sass = await _sassPromise;
        return sass.compile(filename, { style: 'expanded' }).css;
    } catch (err) {
        throw new Error(
            `gjsify css-as-string: failed to compile Sass file ${filename}. ` +
                `Is the \`sass\` package installed? (${(err as Error).message})`,
        );
    }
}

async function loadAndBundleCss(filename: string, targets: Targets | undefined): Promise<Uint8Array> {
    if (!_bundlerPromise) _bundlerPromise = pickBundler();
    const bundler = await _bundlerPromise;
    const { code } = await bundler(filename, targets);
    return code;
}
