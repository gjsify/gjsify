// @gjsify/sqlite-native — thin TS wrapper around the GjsifySqlite GIR module.
//
// The real implementation lives in src/vala/*.vala, compiled to
// prebuilds/<platform>/libgjsifysqlite.so + GjsifySqlite-1.0.typelib by meson.
// This module loads the typelib lazily and exposes typed wrappers.
//
// Loading is intentionally try/catch — same pattern as @gjsify/terminal-native
// — so consuming packages (`@gjsify/sqlite`) can fall back gracefully when the
// prebuild is not installed (e.g. unsupported architecture). Callers MUST
// check `hasNativeSqlite()` before using the module.
//
// Callers loading this from inside `gjsify run` get LD_LIBRARY_PATH /
// GI_TYPELIB_PATH set automatically via `detectNativePackages()` —
// the package's `gjsify.prebuilds` field is read by the CLI.

// Types provided by the auto-generated declaration in src/ts/gjsifysqlite-1.0.d.ts
import type { GjsifySqlite as GjsifySqliteNS } from 'gi://GjsifySqlite?version=1.0';
import { loadOptionalNativeModule } from '@gjsify/utils/core';

type DatabaseInstance = GjsifySqliteNS.Database;
type DatabaseStatic = typeof GjsifySqliteNS.Database;
type StatementInstance = GjsifySqliteNS.Statement;
type StatementStatic = typeof GjsifySqliteNS.Statement;

export interface NativeSqliteModule {
    Database: DatabaseStatic;
    Statement: StatementStatic;
    OpenMode: typeof GjsifySqliteNS.OpenMode;
    StepResult: typeof GjsifySqliteNS.StepResult;
    ColumnType: typeof GjsifySqliteNS.ColumnType;
}

export type { DatabaseInstance as Database };
export type { StatementInstance as Statement };

let _native: NativeSqliteModule | null = null;
let _loaded = false;
let _loadError: Error | null = null;

/**
 * Lazily load the GjsifySqlite typelib. Idempotent — subsequent calls
 * return the cached module (or `null` if the first call failed).
 */
export function loadNativeSqlite(): NativeSqliteModule | null {
    if (_loaded) return _native;
    _loaded = true;
    // Static `gi://` resolution would happen during ESM linking, before
    // LD_LIBRARY_PATH / GI_TYPELIB_PATH are set; `imports.gi.*` resolves at
    // runtime. A typelib without a loadable library reads as absent rather
    // than failing at first use, with the missing dependency in `getLoadError()`.
    const { module, error } = loadOptionalNativeModule<NativeSqliteModule>('GjsifySqlite', ['Database', 'Statement']);
    _native = module;
    _loadError = error;
    return _native;
}

/**
 * Returns `true` if the GjsifySqlite typelib is loadable (prebuild present).
 */
export function hasNativeSqlite(): boolean {
    return loadNativeSqlite() !== null;
}

/**
 * Returns the load error from the first `loadNativeSqlite()` call, or `null`
 * if loading succeeded or hasn't been attempted yet.
 */
export function getLoadError(): Error | null {
    return _loadError;
}
