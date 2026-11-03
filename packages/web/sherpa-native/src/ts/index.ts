// @gjsify/sherpa-native — thin TS wrapper around the GjsifySherpa GIR module.
//
// The real implementation lives in src/vala/*.vala and src/c/*.c, compiled to
// prebuilds/<platform>/libgjsifysherpa.so + GjsifySherpa-1.0.typelib by meson,
// with sherpa-onnx linked in statically and `libonnxruntime.so` staged beside
// the library (meson.build § onnxruntime says why that one cannot be static).
//
// Loading is intentionally try/catch — the same pattern as
// @gjsify/sqlite-native — so consuming packages (`@gjsify/vad`) can fall back
// gracefully when the prebuild is not installed (e.g. an architecture this
// package has not been built for yet). Callers MUST check `hasNativeSherpa()`
// before using the module.
//
// NO MODEL PATH IS DEFAULTED HERE. Every recognizer and the detector take the
// files from the caller, because this package ships none (ADR 0127 decision
// 14); `@gjsify/vad` is the layer that knows where a model cache lives.

// Types provided by the auto-generated declaration in src/ts/gjsifysherpa-1.0.d.ts
import type { GjsifySherpa as GjsifySherpaNS } from 'gi://GjsifySherpa?version=1.0';
import { loadOptionalNativeModule } from '@gjsify/utils/core';

type VadInstance = GjsifySherpaNS.Vad;
type VadStatic = typeof GjsifySherpaNS.Vad;
type OnlineRecognizerInstance = GjsifySherpaNS.OnlineRecognizer;
type OnlineRecognizerStatic = typeof GjsifySherpaNS.OnlineRecognizer;
type OnlineStreamInstance = GjsifySherpaNS.OnlineStream;
type OfflineRecognizerInstance = GjsifySherpaNS.OfflineRecognizer;
type OfflineRecognizerStatic = typeof GjsifySherpaNS.OfflineRecognizer;
type OfflineStreamInstance = GjsifySherpaNS.OfflineStream;

/**
 * The module as `imports.gi.GjsifySherpa` actually presents it.
 *
 * The free functions keep their C names: GJS camel-cases METHODS but not
 * namespace-level functions, so `onnxruntime_version` and `file_exists` are
 * what the typelib hands over — verified against the built library, not
 * assumed.
 */
export interface NativeSherpaModule {
    Vad: VadStatic;
    OnlineRecognizer: OnlineRecognizerStatic;
    OfflineRecognizer: OfflineRecognizerStatic;
    /** The statically linked sherpa-onnx version, e.g. `2.0.1`. */
    version(): string;
    /** The onnxruntime version sherpa-onnx was built against, e.g. `1.28.2`. */
    onnxruntime_version(): string;
    /** Whether a path is readable, as sherpa-onnx itself would judge it. */
    file_exists(path: string): boolean;
}

export type { VadInstance as Vad };
export type { OnlineRecognizerInstance as OnlineRecognizer };
export type { OnlineStreamInstance as OnlineStream };
export type { OfflineRecognizerInstance as OfflineRecognizer };
export type { OfflineStreamInstance as OfflineStream };

let _native: NativeSherpaModule | null = null;
let _loaded = false;
let _loadError: Error | null = null;

/**
 * Lazily load the GjsifySherpa typelib. Idempotent — subsequent calls
 * return the cached module (or `null` if the first call failed).
 */
export function loadNativeSherpa(): NativeSherpaModule | null {
    if (_loaded) return _native;
    _loaded = true;
    // Static `gi://` resolution would happen during ESM linking, before
    // LD_LIBRARY_PATH / GI_TYPELIB_PATH are set; `imports.gi.*` resolves at
    // runtime. A typelib without a loadable library reads as absent rather
    // than failing at first use, with the missing dependency in `getLoadError()`.
    const { module, error } = loadOptionalNativeModule<NativeSherpaModule>('GjsifySherpa', [
        'Vad',
        'OnlineRecognizer',
        'OfflineRecognizer',
    ]);
    _native = module;
    _loadError = error;
    return _native;
}

/**
 * Returns `true` if the GjsifySherpa typelib is loadable (prebuild present).
 */
export function hasNativeSherpa(): boolean {
    return loadNativeSherpa() !== null;
}

/**
 * Returns the load error from the first `loadNativeSherpa()` call, or `null`
 * if loading succeeded or hasn't been attempted yet.
 */
export function getLoadError(): Error | null {
    return _loadError;
}
