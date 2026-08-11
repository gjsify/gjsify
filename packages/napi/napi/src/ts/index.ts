// @gjsify/napi — L1 loader for the GjsifyNapi native N-API host shim.
//
// Uses GJS's legacy `imports.gi` API (synchronous) rather than `gi://` ESM so
// the loader stays usable from both library code and runtime entry points
// (mirrors @gjsify/tls-native).
//
// Bootstrap contract (ADR 0011): `GjsifyNapi.init()` installs ONE
// non-enumerable JSNative `globalThis.__gjsifyNapiLoadAddon`; this L1 calls
// init() once, captures the native and deletes the global property. From then
// on `loadAddon(path)` is a plain JS→JSNative call — the addon's `exports`
// object is a normal return value and load failures are normal JS exceptions
// (file-not-found, dlerror, legacy/non-napi addon, unsupported version).

/** Introspected shape of the `GjsifyNapi` GI namespace (GjsifyNapi-1.0.gir). */
export interface GjsifyNapiModule {
    /**
     * Install the N-API host into the running GJS context. Idempotent.
     * Returns `false` when there is no current GjsContext/JSContext.
     */
    init(): boolean;
    /** Probe that the native typelib is loaded. */
    is_available(): boolean;
}

/** The addon-loader native installed by `GjsifyNapi.init()`. */
type LoadAddonFn = (path: string) => Record<string, unknown>;

interface _GjsImportsHost {
    imports?: { gi?: Record<string, unknown> };
}

/** Host slot the bootstrap native is installed into (captured + deleted). */
interface _NapiBootstrapHost {
    __gjsifyNapiLoadAddon?: LoadAddonFn;
}

let _mod: GjsifyNapiModule | null = null;

const _gi: Record<string, unknown> | undefined = (globalThis as unknown as _GjsImportsHost).imports?.gi;
if (_gi) {
    try {
        _mod = _gi['GjsifyNapi'] as GjsifyNapiModule;
    } catch {
        // Typelib not in GI_TYPELIB_PATH — degrade instead of crashing at
        // import time: `hasNapi()` then returns false and `loadAddon()` throws.
    }
}

/** The native GjsifyNapi module, or `null` if not installed. */
export const nativeNapi: GjsifyNapiModule | null = _mod;

/** Returns `true` when the GjsifyNapi native shim is available. */
export function hasNapi(): boolean {
    return _mod !== null;
}

let _loadAddon: LoadAddonFn | null = null;

function ensureInstalled(): LoadAddonFn {
    if (_loadAddon) return _loadAddon;
    if (!_mod) {
        throw new Error('@gjsify/napi: native typelib not loaded. Check hasNapi() first.');
    }
    if (!_mod.init()) {
        throw new Error('@gjsify/napi: GjsifyNapi.init() failed — no running GJS JSContext.');
    }
    const host = globalThis as unknown as _NapiBootstrapHost;
    const native = host.__gjsifyNapiLoadAddon;
    if (typeof native !== 'function') {
        throw new Error('@gjsify/napi: bootstrap native __gjsifyNapiLoadAddon was not installed.');
    }
    // Capture, then remove the bootstrap global — no side-channel remains.
    delete host.__gjsifyNapiLoadAddon;
    _loadAddon = native;
    return native;
}

/**
 * Load a compiled Node-API addon (`.node`) into the running GJS context.
 *
 * `path` is the filesystem path to the shared object; the addon must be a pure
 * Node-API module (e.g. a stock node-gyp build), legacy NAN/V8 addons are
 * rejected with a clear error. Returns the addon's `exports` object — a second
 * load of the same realpath returns the cached one.
 */
export function loadAddon(path: string): Record<string, unknown> {
    return ensureInstalled()(path);
}
