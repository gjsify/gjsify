# @gjsify/native-sqlite-bridge

The NativeScript driver behind `node:sqlite` ([ADR 0147](../../../docs/adr/0147-node-sqlite-on-nativescript-binds-the-platform-sqlite.md)).
`@gjsify/sqlite` picks it up on `--app nativescript` through its `native.android.ts` /
`native.ios.ts` platform files; an app does not import this package directly.

| Platform | Driver |
|---|---|
| Android | `androidx.sqlite` `BundledSQLiteDriver` — SQLite 3.46 with FTS5 from the AAR, not the OS image's |
| iOS | not built: opening a database throws a clear error |

## What an Android app must add

1. The Gradle dependencies, in `App_Resources/Android/app.gradle` (both: the bundled driver
   alone does not put the `androidx.sqlite` interfaces on the compile classpath):

   ```gradle
   dependencies {
     implementation 'androidx.sqlite:sqlite:2.5.2'
     implementation 'androidx.sqlite:sqlite-bundled:2.5.2'
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
- Constraint errors carry the primary code mapped from the message (a rowid clash reports 2067,
  not 1555); other errors carry the primary code only.
- `StatementSync#expandedSQL` falls back to the source text; `in_transaction` is tracked from the
  `BEGIN`/`SAVEPOINT`/`COMMIT`/`ROLLBACK` statements that pass through the connection.
