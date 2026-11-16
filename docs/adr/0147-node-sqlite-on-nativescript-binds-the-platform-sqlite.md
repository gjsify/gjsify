# 146. `node:sqlite` on NativeScript binds the platform's SQLite, one driver per OS

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
4. **The extended result code is part of the contract.** `androidx.sqlite` throws
   `SQLiteException` carrying the primary code only, as far as the public API goes. Whether the
   extended code is recoverable (for example from the message) is unverified. Until a device run
   settles it, the Android driver reports the primary code, and this ADR stays Proposed.
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
- Android `BLOB` and `INTEGER` > 2^53 cross the Java bridge as `byte[]` and `long`; the driver
  converts to `Uint8Array` and `bigint` explicitly rather than relying on bridge coercion.
- `:memory:` and file databases both work through the driver; the default path for relative
  names is the app's `getDatabasePath` directory, which is a documented divergence from Node's
  cwd-relative open.
- Not decided: `react-native` slot (declaration-only), and whether the iOS driver should be
  shared with a future Swift/ObjC consumer.

## Open

- Verify extended error codes on `sqlite-bundled` (decision 4).
- Measure `step()` throughput across the bridge for a 10 000-row read (ADR 0123 benchmark shape).
- Decide where the Gradle dependency is declared so `gjsify ship` / the NS composer picks it up.
