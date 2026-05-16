// @gjsify/http2-native — thin TS wrapper around the GjsifyHttp2 GIR module.
//
// The real implementation lives in src/vala/*.vala (+ nghttp2-helpers.c),
// compiled to prebuilds/<platform>/libgjsifyhttp2.so + GjsifyHttp2-1.0.typelib
// by meson. This module loads the typelib lazily and exposes typed wrappers.
//
// Loading is intentionally try/catch — same pattern as @gjsify/terminal-native
// — so consuming packages (`@gjsify/http2`) can fall back gracefully when the
// prebuild is not installed (e.g. unsupported architecture). Callers MUST
// check `hasNativeHttp2()` before using `nativeHttp2`.
//
// Callers loading this from inside `gjsify run` get LD_LIBRARY_PATH /
// GI_TYPELIB_PATH set automatically via `detectNativePackages()` —
// the package's `gjsify.prebuilds` field is read by the CLI.

// Types provided by the auto-generated declaration in src/ts/gjsifyhttp2-1.0.d.ts
import type { GjsifyHttp2 as GjsifyHttp2NS } from 'gi://GjsifyHttp2?version=1.0';

type FrameEncoderInstance = GjsifyHttp2NS.FrameEncoder;
type FrameEncoderCtor = typeof GjsifyHttp2NS.FrameEncoder;
type StreamIdAllocatorInstance = GjsifyHttp2NS.StreamIdAllocator;
type StreamIdAllocatorCtor = typeof GjsifyHttp2NS.StreamIdAllocator;
type SessionBridgeInstance = GjsifyHttp2NS.SessionBridge;
type SessionBridgeStatic = typeof GjsifyHttp2NS.SessionBridge;

export interface NativeHttp2Module {
  FrameEncoder: FrameEncoderCtor;
  StreamIdAllocator: StreamIdAllocatorCtor;
  SessionBridge: SessionBridgeStatic;
}

export type { FrameEncoderInstance as FrameEncoder };
export type { StreamIdAllocatorInstance as StreamIdAllocator };
export type { SessionBridgeInstance as SessionBridge };

let _native: NativeHttp2Module | null = null;
let _loaded = false;
let _loadError: Error | null = null;

/**
 * Lazily load the GjsifyHttp2 typelib. Idempotent — subsequent calls
 * return the cached module (or `null` if the first call failed).
 */
export function loadNativeHttp2(): NativeHttp2Module | null {
  if (_loaded) return _native;
  _loaded = true;
  try {
    // Static `gi://` resolution would happen during ESM linking,
    // before LD_LIBRARY_PATH / GI_TYPELIB_PATH are set. Use the
    // synchronous `imports.gi.*` form so resolution happens at runtime.
    const gi = (globalThis as unknown as { imports?: { gi?: { GjsifyHttp2?: unknown } } }).imports?.gi;
    if (!gi) {
      _loadError = new Error('imports.gi not available — not running under GJS?');
      return null;
    }
    const mod = gi.GjsifyHttp2 as unknown;
    if (!mod) {
      _loadError = new Error('GjsifyHttp2 typelib not found on GI_TYPELIB_PATH');
      return null;
    }
    _native = mod as NativeHttp2Module;
    return _native;
  } catch (err) {
    _loadError = err instanceof Error ? err : new Error(String(err));
    _native = null;
    return null;
  }
}

/**
 * Returns `true` if the GjsifyHttp2 typelib is loadable (prebuild present).
 */
export function hasNativeHttp2(): boolean {
  return loadNativeHttp2() !== null;
}

/**
 * Returns the load error from the first `loadNativeHttp2()` call, or `null`
 * if loading succeeded or hasn't been attempted yet.
 */
export function getLoadError(): Error | null {
  return _loadError;
}
