// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — capability-slot stub.
//
// This file is the browser entry point selected by the package's `"browser"`
// field + `exports."."` `"browser"` condition (Rolldown/Vite browser builds
// honour both via `mainFields:['browser','module','main']` and
// `conditionNames:['import','browser']`).
//
// Strategy — CAPABILITY SLOT:
//   `@gjsify/sqlite` deliberately ships an explicit-failure browser
//   polyfill instead of bundling a WebAssembly SQLite engine. Reasons:
//     1. A real SQLite-WASM dropdown (wa-sqlite, sql.js, sqlite-wasm)
//        is 0.5-1.5 MB compressed; forcing it on every consumer that
//        imports `node:sqlite` transitively (e.g. via test fixtures or
//        an unused branch) bloats unrelated bundles.
//     2. The right WASM backend depends on persistence needs (OPFS vs
//        IndexedDB vs in-memory) and the consumer should decide.
//
//   The polyfill is "non-throwing on import" — consumers can `import`
//   the module, inspect the `constants`, type-check against the API,
//   and ship code that conditionally uses SQLite. Calling
//   `new DatabaseSync(...)` or `new StatementSync(...)` throws a
//   structured ENOTSUP that points at the wiring strategy for a real
//   WASM backend.
//
// Follow-up (tracked under "Open TODOs"):
//   A future welle will add a `@gjsify/sqlite/wasm-backend` registration
//   hook that wires `refs/wa-sqlite` (Roy Hashimoto, MIT) or `refs/sql.js`
//   (Apache-2.0 / MIT) at runtime when the consumer opts in. The
//   `DatabaseSync` / `StatementSync` classes here will then delegate to
//   the registered backend instead of throwing.
//
// Known gaps (slot: partial):
//   - Calling any DB / statement constructor throws ENOTSUP.
//   - No `constants.SQLITE_*` errno table (the existing GJS constants
//     module is re-exported as-is; values mirror Node's node:sqlite).

export { constants } from './constants.js';
export * from './constants.js';

// Re-export the typed surface from the GJS impl so consumers can keep
// their import sites (`import type { RunResult } from 'node:sqlite'`)
// working without a separate `@types/*` package.
export type { DatabaseSyncOptions, StatementSyncOptions, RunResult, ColumnInfo, SQLiteValue } from './types.js';

function _enotsup(api: string): Error {
    const err = new Error(
        `@gjsify/sqlite: ${api} is not available in the browser polyfill. ` +
            `Ship a WebAssembly SQLite backend (refs/wa-sqlite or refs/sql.js) and ` +
            `wire it via the @gjsify/sqlite/wasm-backend hook (follow-up — tracked in ` +
            `STATUS.md "Open TODOs").`,
    ) as Error & { code?: string };
    err.code = 'ENOTSUP';
    return err;
}

// ─── DatabaseSync — explicit-failure stub ──────────────────────────────────

export class DatabaseSync {
    constructor(_path: string | URL | Uint8Array, _options?: Record<string, unknown>) {
        throw _enotsup('new DatabaseSync()');
    }

    // Method stubs kept for `instanceof` + duck-typing reflection. They
    // are unreachable because the constructor throws — but documenting
    // the API surface here helps tooling (TS lookup, `keyof DatabaseSync`).
    open(): void {
        throw _enotsup('DatabaseSync.prototype.open');
    }
    close(): void {
        throw _enotsup('DatabaseSync.prototype.close');
    }
    exec(_sql: string): void {
        throw _enotsup('DatabaseSync.prototype.exec');
    }
    prepare(_sql: string): StatementSync {
        throw _enotsup('DatabaseSync.prototype.prepare');
    }
    function(_name: string, _options: unknown, _fn?: unknown): void {
        throw _enotsup('DatabaseSync.prototype.function');
    }
    aggregate(_name: string, _options: unknown): void {
        throw _enotsup('DatabaseSync.prototype.aggregate');
    }
    backup(_destination: string | URL): Promise<number> {
        return Promise.reject(_enotsup('DatabaseSync.prototype.backup'));
    }
    loadExtension(_path: string): void {
        throw _enotsup('DatabaseSync.prototype.loadExtension');
    }
    enableLoadExtension(_enable: boolean): void {
        throw _enotsup('DatabaseSync.prototype.enableLoadExtension');
    }
    get isOpen(): boolean {
        return false;
    }
    get isTransaction(): boolean {
        return false;
    }
}

// ─── StatementSync — explicit-failure stub ─────────────────────────────────

export class StatementSync {
    constructor() {
        throw _enotsup('new StatementSync()');
    }
    all(..._params: unknown[]): unknown[] {
        throw _enotsup('StatementSync.prototype.all');
    }
    get(..._params: unknown[]): unknown {
        throw _enotsup('StatementSync.prototype.get');
    }
    run(..._params: unknown[]): unknown {
        throw _enotsup('StatementSync.prototype.run');
    }
    iterate(..._params: unknown[]): Iterator<unknown> {
        throw _enotsup('StatementSync.prototype.iterate');
    }
    columns(): unknown[] {
        throw _enotsup('StatementSync.prototype.columns');
    }
    setAllowBareNamedParameters(_enable: boolean): void {
        throw _enotsup('StatementSync.prototype.setAllowBareNamedParameters');
    }
    setAllowUnknownNamedParameters(_enable: boolean): void {
        throw _enotsup('StatementSync.prototype.setAllowUnknownNamedParameters');
    }
    setReadBigInts(_enable: boolean): void {
        throw _enotsup('StatementSync.prototype.setReadBigInts');
    }
    get sourceSQL(): string {
        throw _enotsup('StatementSync.prototype.sourceSQL');
    }
    get expandedSQL(): string {
        throw _enotsup('StatementSync.prototype.expandedSQL');
    }
}

import { constants as _constants } from './constants.js';

export default {
    DatabaseSync,
    StatementSync,
    constants: _constants,
};
