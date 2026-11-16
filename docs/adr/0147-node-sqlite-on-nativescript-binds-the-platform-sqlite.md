# 147. `node:sqlite` on NativeScript binds the platform's SQLite, one driver per OS

- Status: **Proposed** (2026-11-16)
- Date: 2026-11-16
- Deciders: Pascal Garber
- Related: [ADR 0123](0123-node-sqlite-runs-on-libsqlite3-through-a-vala-bridge.md) (the GJS
  bridge and the thin-native / Node-semantics-in-TS split), [ADR 0144](0144-background-and-autostart-have-one-driver-per-platform.md)
  (one driver per platform); `packages/node/sqlite`, `packages/node/sqlite-native`

## Context

`@gjsify/sqlite` declares `runtimes.nativescript: "none"`. On GJS it runs on
`@gjsify/sqlite-native`, a Vala/GObject library over the system libsqlite3, loaded as a typelib
(ADR 0123). That mechanism does not exist on NativeScript:

- Vala/GIR needs GObject introspection; NativeScript has none (outside the node-gi/GTK-on-Android
  experiments, which are not a base to build a storage layer on).
- NativeScript has no N-API host, so a `.node` prebuild cannot load.
- iOS forbids loading downloaded or JIT-generated native code; only code linked at build time runs.

What NativeScript does have is a reflection bridge to the platform SDK: Java/Kotlin classes on
Android (`java.*`, `android.*`, `androidx.*`, the pattern `@gjsify/native-fs-bridge` already uses
under `packages/nativescript-bridge/`), and Objective-C classes plus C functions of linked system
frameworks on iOS.

The seam is already there: ADR 0123 keeps the native layer to the C API (`Database`:
open/exec/prepare/close; `Statement`: bind by index, `step()`, typed column readers) and puts every
Node semantic in TypeScript. A NativeScript backend only has to implement that same thin surface.

## Options considered

| Option | Verdict |
|---|---|
| `android.database.sqlite.SQLiteDatabase` (framework API) | Rejected as the primary path. It is cursor- and ContentValues-shaped: no prepared statement with arbitrary index binding plus `step()` reuse, no extended result codes (it throws `SQLiteConstraintException` without the code), and the SQLite version is whatever the OS image ships (3.22 on API 29 vs 3.4x on API 35). Node's surface cannot be built faithfully on it. |
| Own `.so` + JNI bridge | Rejected. Needs an NDK toolchain, one build per ABI, and a Java shim class per entry point, to reproduce what `androidx.sqlite` already ships. |
| SQLite WASM (wa-sqlite, sql.js) | Rejected for now. NativeScript's V8 runs WASM, but persistence needs a VFS over the NS file API, and it ignores the platform SQLite. Stays the browser slot's intended backend. |
| **`androidx.sqlite` driver API** (`SQLiteDriver` → `SQLiteConnection` → `SQLiteStatement`) | **Chosen for Android.** It is the C API in Kotlin clothing: `prepare(sql)`, `bindLong/Double/Text/Blob/Null(index, v)` (1-based), `step()`, `getColumnCount/Name/Type`, `getLong/Double/Text/Blob`, `reset`, `clearBindings`, `close`. `androidx.sqlite:sqlite-bundled` carries its own libsqlite3 per ABI (arm64-v8a, x86_64, …), so the version is ours, not the OS image's; `AndroidSQLiteDriver` is the zero-size fallback over the framework. |
| System `SQLite3` C API through the NS iOS bridge | **Chosen for iOS.** `libsqlite3.tbd` is a system library, always present, and NativeScript exposes its C functions (`sqlite3_open_v2`, `sqlite3_prepare_v2`, `sqlite3_bind_*`, `sqlite3_step`, `sqlite3_column_*`, `sqlite3_extended_errcode`) with `interop.Reference` for out-pointers. No code is loaded at run time, so the JIT/dlopen rule is not touched. |

## Decision

1. **`@gjsify/sqlite` gains a NativeScript backend, selected at build time by
   `--app nativescript`**, behind the same `NativeSqliteModule` shape that `native.ts` returns for
   GJS. `DatabaseSync`/`StatementSync` stay untouched; only `native.ts` is routed per platform
   (platform-file resolution, `native.android.ts` / `native.ios.ts` / `native.ts`).
2. **Android driver: `androidx.sqlite` `SQLiteConnection`/`SQLiteStatement`**, opened through
   `BundledSQLiteDriver` (a consuming app adds `androidx.sqlite:sqlite-bundled` through its
   `include.gradle`). `AndroidSQLiteDriver` is accepted as a degraded fallback with the OS's SQLite
   version; the driver reports which one it got.
3. **iOS driver: the system `SQLite3` C functions** through the NativeScript iOS bridge.
4. **The error code is the primary code; the extended one is derived, best effort.** Measured
   (Spike): `SQLiteException` surfaces in JS as `android.database.SQLException` whose message is
   `Error code: <primary>, message: <sqlite3_errmsg>`, with no accessor for the extended code. The
   driver parses the primary code out of the message and maps the well-known constraint messages
   (`UNIQUE constraint failed` → 2067, `NOT NULL …` → 1299, `FOREIGN KEY …` → 787, `CHECK …` →
   275). A rowid primary-key clash reads `UNIQUE constraint failed: t.id` too, so it reports 2067
   where SQLite says 1555; that ambiguity is documented, not hidden.
5. **Package layout:** the two drivers live in `packages/nativescript-bridge/sqlite`
   (`@gjsify/native-sqlite-bridge`, `nativescript: "native"`, other slots `none`, same convention
   as `native-fs-bridge`); `@gjsify/sqlite` depends on it only through the nativescript slot.
   `@gjsify/sqlite` then moves `nativescript` from `none` to `partial`.
6. **No Node semantics in the drivers.** Named parameters, `readBigInts`, error classes and
   statement caching remain in `@gjsify/sqlite` (ADR 0123 decision 3). Lifetime (finalise
   statements on `close()`) is owned by the driver, since NS GC order is no more ours than
   SpiderMonkey's.

## Consequences

- A new package and an Android build dependency for apps that use `node:sqlite` (bundled driver:
  roughly 1 MB per ABI). Apps that do not import `node:sqlite` pay nothing.
- The first implementation can be verified only on a device/emulator (arm64-v8a and x86_64 for the
  emulator); unit specs use a fake driver for the JS-side mapping, the real driver is covered by
  an e2e under `tests/e2e/`.
- `BLOB` and `INTEGER` > 2^53 do NOT convert on their own (Spike): see § Spike. The driver binds
  a 64-bit integer as `java.lang.Long.parseLong(String(v))` and reads it back as
  `BigInt(String(getLong(i)))`; a blob is read as an indexable `byte[]` and copied into a
  `Uint8Array` (`& 0xff`).
- `:memory:` and file databases both work through the driver; the default path for relative
  names is the app's `getDatabasePath` directory, which is a documented divergence from Node's
  cwd-relative open.
- Not decided: `react-native` slot (declaration-only), and whether the iOS driver should be
  shared with a future Swift/ObjC consumer.

## Spike (2026-11-16, Android emulator API 36, x86_64, `androidx.sqlite:*:2.5.2`)

A throwaway NativeScript app (`@nativescript/android` 9.1.1, Vite 8) called the driver classes
from JS. Measured, all through `BundledSQLiteDriver`:

| Question | Result |
|---|---|
| `:memory:` and file database (`getDatabasePath`) | works |
| SQLite version | 3.46.0, from the AAR, not the OS image |
| FTS5 (`CREATE VIRTUAL TABLE … USING fts5`, `MATCH`) | works; compile options list `ENABLE_FTS3/4/5` |
| `PRAGMA journal_mode=WAL` | answers `wal` |
| prepare / bind (1-based) / `step` / `reset` + `clearBindings` reuse / `close` | works |
| `bindNull`, `getColumnType` (NULL = 5), `getDouble`, `getText` (UTF-8 incl. ä€ö) | works |
| `INTEGER` > 2^53 | `bindLong(i, 9007199254740993n)` throws "Failed resolving method"; `bindLong(i, Number(v))` rounds; `bindLong(i, java.lang.Long.parseLong(str))` is exact. `getLong` returns an object whose `String()` is exact → `BigInt(String(x))` |
| `new java.lang.Long(str)` as the argument | WRONG value (stored 2791); do not use |
| `BLOB` | bind a `Array.create('byte', n)`; `getBlob` returns an indexable `byte[]` (signed), not a `Uint8Array` |
| Extended error code | not reachable: only `Error code: <primary>, message: …` (decision 4) |
| 10 000-row `step()` + `getLong` + `getText` read | 72 ms |

Two findings that are not about SQLite:

- **The NativeScript metadata generator drops `androidx.sqlite` unless it is whitelisted.** An app
  with `whitelist-plugins-usages: true` in `App_Resources/Android/native-api-usage.json` (the
  Learn6502 and Steuererklärung shells have it) sees `androidx.sqlite` as `undefined` at run
  time. The consuming app must list `androidx.sqlite.driver.bundled:BundledSQLiteDriver`,
  `androidx.sqlite.driver:AndroidSQLiteDriver`, `androidx.sqlite:SQLiteDriver`,
  `…:SQLiteConnection`, `…:SQLiteStatement`, `…:SQLiteException`. This is the answer to the
  "where is the dependency declared" question: the Gradle line in the app's `app.gradle`
  (`include.gradle` of a plugin works the same way) plus those whitelist entries; the package
  documents both.
- The classes sit in `androidx.sqlite.driver.bundled` (`BundledSQLiteDriver`) and `androidx.sqlite`
  (the interfaces); `Application.android.context` is not set at app start, use
  `Utils.android.getApplicationContext()`.

## What the driver must still build (why this is not a thin wrapper)

`NativeSqliteModule` is shaped by the GObject binding, not by the C API alone. The Spike shows
`androidx.sqlite` lacks several of its members, each needing an adapter written in TS:

- `Statement.bind_parameter_index/name`, `bind_parameter_count`: no API. Needs a small SQL
  tokenizer for `?`, `?NNN`, `:a`, `@a`, `$a` (skipping strings, comments, quoted identifiers).
- `Database.exec(script)`: `prepare` compiles ONE statement; `sqlite3_exec` semantics need
  statement-boundary splitting, i.e. the same tokenizer plus `CREATE TRIGGER … BEGIN … END`.
- `Database.changes` / `last_insert_rowid`: `SELECT changes(), last_insert_rowid()` after each write.
- `Database.in_transaction` (`sqlite3_get_autocommit`): no API found in the public surface; the
  `SQLiteKt.inTransaction` helper is unverified.
- `Statement.expanded_sql`, `column_decltype`: no API.
- `bind_blob` takes `GLib.Bytes | Uint8Array`, `column_blob` returns `GLib.Bytes`; the module type
  names GLib, which NativeScript does not have, so `NativeSqliteModule` needs a GLib-free
  restatement before a second backend can implement it.

## Device proof (2026-11-16, emulator API 36, `import { DatabaseSync } from 'node:sqlite'`)

A throwaway NativeScript app (`--app nativescript`, workspace builds of `@gjsify/sqlite` and
`@gjsify/native-sqlite-bridge`) ran green: `:memory:` (SQLite 3.46.0), named parameters, `run()`
(`changes`, `lastInsertRowid`), `all()`, file DB under the app database directory, FTS5, BigInt
round trip (`9007199254740993n`), BLOB as `Uint8Array`, `BEGIN`/`ROLLBACK` with `isTransaction`,
UNIQUE failure as `SqliteError` with `errcode` 2067, syntax error with `errcode` 1.

Two findings from the run, both fixed in the driver:

- `open(path, flags)` with `file:` handling: the URI flag is always on in `DatabaseSync`, so only a
  path that actually starts with `file:` is rejected.
- `sqlite3_reset()` repeats the error of the last `step()`; `Statement.reset()` now swallows it,
  otherwise the raw Java exception replaced the `SqliteError`.

The app is not committed; there is no automated device test yet.

## Open

- A repeatable device test (the proof above is a manual run).
- `in_transaction` is tracked from the statement text; `SQLiteKt.inTransaction` stays unverified.
- Measure against the ADR 0123 benchmark shape (the 72 ms above is the read half only).
- iOS driver: unchanged, not started.
