// @gjsify/rolldown-native — thin TS wrapper around the GjsifyRolldown
// GIR module + Rust cdylib.
//
// The real implementation lives in:
//   src/rust/   — Rust shim wrapping rolldown::Bundler::generate via
//                 a per-call current-thread tokio runtime
//   src/vala/   — C glue + Vala bridge (same pattern as
//                 @gjsify/lightningcss-native and @gjsify/http2-native)
//
// Loading is intentionally try/catch — when the prebuild for the
// running architecture isn't installed, consuming packages
// (`@gjsify/cli` build pipeline) can fall back to npm `rolldown`
// under Node and surface a clear error under GJS.

import type { GjsifyRolldown as GjsifyRolldownNS } from 'gi://GjsifyRolldown?version=1.0';
import type GLib from '@girs/glib-2.0';

type BundlerInstance = GjsifyRolldownNS.Bundler;
type BundlerCtor = typeof GjsifyRolldownNS.Bundler;

export interface NativeRolldownModule {
  Bundler: BundlerCtor;
}

export type { BundlerInstance as Bundler };

let _native: NativeRolldownModule | null = null;
let _loaded = false;
let _loadError: Error | null = null;

export function loadNativeRolldown(): NativeRolldownModule | null {
  if (_loaded) return _native;
  _loaded = true;
  try {
    const gi = (globalThis as unknown as { imports?: { gi?: { GjsifyRolldown?: unknown } } }).imports?.gi;
    if (!gi) {
      _loadError = new Error('imports.gi not available — not running under GJS?');
      return null;
    }
    const mod = gi.GjsifyRolldown as unknown;
    if (!mod) {
      _loadError = new Error('GjsifyRolldown typelib not found on GI_TYPELIB_PATH');
      return null;
    }
    _native = mod as NativeRolldownModule;
    return _native;
  } catch (err) {
    _loadError = err instanceof Error ? err : new Error(String(err));
    _native = null;
    return null;
  }
}

export function hasNativeRolldown(): boolean {
  return loadNativeRolldown() !== null;
}

export function getLoadError(): Error | null {
  return _loadError;
}

/**
 * Subset of rolldown's `BundlerOptions` we expose at the JS layer.
 * Pass anything serde-compatible — unknown keys are rejected by the
 * Rust deserializer with `deny_unknown_fields`.
 */
export interface BundleInputItem {
  name?: string;
  import: string;
}

export interface BundleOptions {
  input: BundleInputItem[] | string | string[];
  cwd?: string;
  format?: 'esm' | 'cjs' | 'iife' | 'umd';
  minify?: boolean;
  sourcemap?: 'File' | 'Inline' | 'Hidden';
  // Pass-through for everything else rolldown's BundlerOptions accepts.
  [extra: string]: unknown;
}

export interface BundleChunk {
  type: 'chunk';
  fileName: string;
  name: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  code: string;
  map?: string;
  sourcemapFilename?: string;
  imports: string[];
  dynamicImports: string[];
}

export interface BundleAsset {
  type: 'asset';
  fileName: string;
  names: string[];
  originalFileNames: string[];
  sourceText?: string;
  sourceBytesLen: number;
}

export type BundleOutputItem = BundleChunk | BundleAsset;

export interface BundleResult {
  warnings: string[];
  output: BundleOutputItem[];
}

function getGLib(): typeof GLib {
  const gi = (globalThis as unknown as { imports?: { gi?: { GLib?: typeof GLib } } }).imports?.gi;
  if (!gi || !gi.GLib) throw new Error('@gjsify/rolldown-native: GLib not available (not running under GJS?)');
  return gi.GLib;
}

// Re-export Phase B plugin facade.
export {
  bundleWithPlugins,
  type NativePlugin,
  type NativePluginContext,
  type PluginIdFilter,
  type LoadHookHandler,
  type TransformHookHandler,
  type ResolveIdHookHandler,
  type RenderChunkHookHandler,
  type AddonHookHandler,
  type LifecycleHookHandler,
} from './plugins.js';

/**
 * Convenience facade: serialize options to JSON, call the native
 * bundler, parse the JSON output. Throws if the prebuild is unavailable
 * or the bundle fails.
 */
export function bundle(options: BundleOptions): BundleResult {
  const native = loadNativeRolldown();
  if (!native) {
    throw new Error(
      `@gjsify/rolldown-native: prebuild not available (${_loadError?.message ?? 'unknown'})`
    );
  }

  const json = JSON.stringify(options);
  const optsBytes = getGLib().Bytes.new(new TextEncoder().encode(json));

  const bundler = new native.Bundler();
  const out = bundler.bundle(optsBytes);
  const data = out.get_data() ?? new Uint8Array(0);
  return JSON.parse(new TextDecoder().decode(data)) as BundleResult;
}
