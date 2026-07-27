// @gjsify/lightningcss-native — thin TS wrapper around the GjsifyLightningcss
// GIR module + Rust cdylib.
//
// The real implementation lives in:
//   src/rust/   — Rust shim using lightningcss crate, exposes extern "C"
//   src/vala/   — C glue (gjsify-lightningcss-glue.{h,c}) + lightningcss.vala
// Compiled by meson into:
//   prebuilds/<platform>/libgjsify_lightningcss.so   (Rust cdylib)
//   prebuilds/<platform>/libgjsifylightningcss.so    (Vala bridge)
//   prebuilds/<platform>/GjsifyLightningcss-1.0.{gir,typelib}
//
// Loading is intentionally try/catch — same pattern as @gjsify/http2-native
// — so consuming packages (`@gjsify/rolldown-plugin-gjsify`'s
// cssAsStringPlugin) can fall back to the npm `lightningcss` package when
// the native prebuild is unavailable. Callers MUST check
// `hasNativeLightningcss()` before using `nativeLightningcss`.
//
// LD_LIBRARY_PATH / GI_TYPELIB_PATH are set automatically by the CLI's
// `detectNativePackages()` walk when running under `gjsify run`.
//
// `transform()` and `bundle()` share ONE lazily-created `Engine` instance
// rather than constructing a fresh one per call — see `getEngine()` below
// for why that is safe (the engine is stateless at every layer) and
// `index.gjs.spec.ts` for the regression guards that keep it that way.

import type { GjsifyLightningcss as GjsifyLightningcssNS } from 'gi://GjsifyLightningcss?version=1.0';
import type GLib from '@girs/glib-2.0';

type EngineInstance = GjsifyLightningcssNS.Engine;
type EngineCtor = typeof GjsifyLightningcssNS.Engine;

export interface NativeLightningcssModule {
    Engine: EngineCtor;
}

export type { EngineInstance as Engine };

let _native: NativeLightningcssModule | null = null;
let _loaded = false;
let _loadError: Error | null = null;

export function loadNativeLightningcss(): NativeLightningcssModule | null {
    if (_loaded) return _native;
    _loaded = true;
    try {
        const gi = (globalThis as unknown as { imports?: { gi?: { GjsifyLightningcss?: unknown } } }).imports?.gi;
        if (!gi) {
            _loadError = new Error('imports.gi not available — not running under GJS?');
            return null;
        }
        const mod = gi.GjsifyLightningcss as unknown;
        if (!mod) {
            _loadError = new Error('GjsifyLightningcss typelib not found on GI_TYPELIB_PATH');
            return null;
        }
        _native = mod as NativeLightningcssModule;
        return _native;
    } catch (err) {
        _loadError = err instanceof Error ? err : new Error(String(err));
        _native = null;
        return null;
    }
}

export function hasNativeLightningcss(): boolean {
    return loadNativeLightningcss() !== null;
}

export function getLoadError(): Error | null {
    return _loadError;
}

let _engine: EngineInstance | null = null;

/**
 * Lazily create — and then reuse — the single `GjsifyLightningcss.Engine`
 * instance that backs every {@link transform} / {@link bundle} call.
 *
 * **Why reuse is safe unconditionally.** The engine carries no per-call
 * state at any layer of the bridge:
 *
 * - Vala (`src/vala/lightningcss.vala`): `Engine` is a `GLib.Object`
 *   subclass declaring ZERO instance fields and ZERO properties. Both
 *   methods take every input as a parameter and keep their only local
 *   (`GLib.Bytes? map`) on the stack — nothing is stored on `this`.
 * - C glue (`src/vala/gjsify-lightningcss-glue.c`): no statics beyond the
 *   idempotent `g_quark_from_static_string` error quark; opts structs and
 *   results are stack locals.
 * - Rust (`src/rust/src/lib.rs`): `gjsify_lightningcss_transform` /
 *   `_bundle` are free `extern "C"` functions over a by-value opts struct,
 *   with no `static mut` / `thread_local!` / lazy global. `Targets`,
 *   `ParserOptions`, `StyleSheet`, `SourceMap`, `Bundler` and
 *   `FileProvider` are all constructed fresh per call and dropped before
 *   it returns; `ParserOptions.warnings` is pinned to `None`, so there is
 *   no diagnostics list to accumulate either.
 *
 * So there is no stored source map, no cached options and no warnings
 * buffer that could leak from one call into the next — a module-level
 * singleton is behaviourally identical to constructing one per call.
 * `index.gjs.spec.ts` pins that behavioural equivalence (A → B → A option
 * ordering, error isolation, and a construction counter).
 *
 * The win is SMALL AND CONSTANT, not a multiple — measured on gjs 1.88 /
 * x86_64 through this facade, hoisting saves ~3-5 us per call (`new
 * Engine()` alone is ~0.9 us; the rest is the JS wrapper plus the GC churn
 * of one more GObject per call). In ratio terms: ~1.2x on a 20 B
 * stylesheet, ~1.06-1.09x at 70-700 B, and within noise at 7 kB, because
 * the lightningcss parse/minify/print dominates everything above trivial
 * input. Worth having — it is strictly less work on every call — but do
 * not expect it to move a real CSS build measurably.
 *
 * Construction stays LAZY and is cached only on success, so a failure to
 * instantiate still surfaces on the call that triggered it rather than
 * once at module load.
 */
function getEngine(native: NativeLightningcssModule): EngineInstance {
    if (_engine === null) _engine = new native.Engine();
    return _engine;
}

/**
 * Convenience facade matching the npm `lightningcss` `transform()` shape.
 * Returns the JS-side `{ code, map }` object expected by callers like
 * `cssAsStringPlugin`. Throws if the native prebuild is unavailable.
 */
export interface TransformInput {
    filename?: string;
    code: Uint8Array | string;
    /** browserslist query, e.g. `"firefox >= 60"` (npm `lightningcss`
     *  accepts a `targets` object; we accept the query string directly). */
    targets?: string;
    minify?: boolean;
    sourceMap?: boolean;
}

export interface TransformResult {
    code: Uint8Array;
    map?: Uint8Array;
}

function getGLib(): typeof GLib {
    const gi = (globalThis as unknown as { imports?: { gi?: { GLib?: typeof GLib } } }).imports?.gi;
    if (!gi || !gi.GLib) throw new Error('@gjsify/lightningcss-native: GLib not available (not running under GJS?)');
    return gi.GLib;
}

export function transform(input: TransformInput): TransformResult {
    const native = loadNativeLightningcss();
    if (!native) {
        throw new Error(`@gjsify/lightningcss-native: prebuild not available (${_loadError?.message ?? 'unknown'})`);
    }

    const codeBytes = typeof input.code === 'string' ? new TextEncoder().encode(input.code) : input.code;
    const codeGBytes = getGLib().Bytes.new(codeBytes);

    const [outCode, outMap] = getEngine(native).transform(
        input.filename ?? null,
        codeGBytes,
        input.targets ?? null,
        Boolean(input.minify),
        Boolean(input.sourceMap),
    );

    const out: TransformResult = { code: outCode.get_data() ?? new Uint8Array(0) };
    if (outMap) {
        const mapData = outMap.get_data();
        if (mapData) out.map = mapData;
    }
    return out;
}

/**
 * Convenience facade matching the npm `lightningcss` `bundle()` /
 * `bundleAsync()` shape but synchronous (the underlying lightningcss
 * `Bundler::bundle` is sync — npm's `bundleAsync` exists only because
 * the JS-side wrapper needed to host the JS resolver callback).
 *
 * Resolves `@import` chains via lightningcss's filesystem-backed
 * `FileProvider` — equivalent to `bundleAsync` with the default
 * `read: fs.readFileSync` resolver.
 */
export interface BundleInput {
    /** Entry CSS file path. */
    filename: string;
    /** browserslist query, e.g. `"firefox >= 60"`. */
    targets?: string;
    minify?: boolean;
    sourceMap?: boolean;
    /** Equivalent of npm `lightningcss`'s `errorRecovery: true`. Default true. */
    errorRecovery?: boolean;
}

export function bundle(input: BundleInput): TransformResult {
    const native = loadNativeLightningcss();
    if (!native) {
        throw new Error(`@gjsify/lightningcss-native: prebuild not available (${_loadError?.message ?? 'unknown'})`);
    }

    const [outCode, outMap] = getEngine(native).bundle(
        input.filename,
        input.targets ?? null,
        Boolean(input.minify),
        Boolean(input.sourceMap),
        input.errorRecovery ?? true,
    );

    const out: TransformResult = { code: outCode.get_data() ?? new Uint8Array(0) };
    if (outMap) {
        const mapData = outMap.get_data();
        if (mapData) out.map = mapData;
    }
    return out;
}
