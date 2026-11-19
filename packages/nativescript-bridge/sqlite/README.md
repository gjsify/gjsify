# @gjsify/native-sqlite-bridge

The NativeScript driver behind `node:sqlite` ([ADR 0147](../../../docs/adr/0147-node-sqlite-on-nativescript-binds-the-platform-sqlite.md)).
`@gjsify/sqlite` picks it up on `--app nativescript` through its `native.android.ts` /
`native.ios.ts` platform files; an app does not import this package directly.

| Platform | Driver |
|---|---|
| Android | `androidx.sqlite` `BundledSQLiteDriver` — SQLite (3.46 or later) with FTS5 from the AAR, not the OS image's |
| iOS | not built: opening a database throws a clear error |

## What an Android app must add

1. The Gradle dependencies, in `App_Resources/Android/app.gradle` (both: the bundled driver
   alone does not put the `androidx.sqlite` interfaces on the compile classpath). **2.6.2 is the
   floor**: it is the release whose bundled driver reports extended result codes, and 2.6.0 the
   one that added `SQLiteConnection.inTransaction()`; the driver relies on both:

   ```gradle
   dependencies {
     implementation 'androidx.sqlite:sqlite:2.7.1'
     implementation 'androidx.sqlite:sqlite-bundled:2.7.1'
   }
   ```

2. If the app sets `whitelist-plugins-usages: true` in `App_Resources/Android/native-api-usage.json`
   (without the entries below `androidx.sqlite` is `undefined` at run time, measured), add to its
   `whitelist` array:

   ```json
   "androidx.sqlite.driver.bundled:BundledSQLiteDriver",
   "androidx.sqlite.driver:AndroidSQLiteDriver",
   "androidx.sqlite:SQLiteDriver",
   "androidx.sqlite:SQLiteConnection",
   "androidx.sqlite:SQLiteStatement",
   "androidx.sqlite:SQLiteException",
   "androidx.sqlite:SQLite"
   ```

## Known differences from Node

- A relative database name lives in the app's `getDatabasePath` directory, not the cwd.
- `file:` URIs are rejected.
- `DatabaseSync#location()` answers that name as given, not the resolved file
  (`PRAGMA database_list` has it).
- `StatementSync#expandedSQL` falls back to the source text; a column's declared type is not
  available.

Error codes are SQLite's extended result codes (`errcode` 2067 for a `UNIQUE` column, 1555 for a
primary key), and `isTransaction` is read from the connection.

## Tests

`gjsify run test` specs the pure-TS parts on Node and GJS against a fake backend (SQL scanning,
byte conversion, error parsing, statement lifetime). The Java half is measured on a device by
`tests/integration/nativescript` (`app/specs/sqlite.smoke.ts`).
