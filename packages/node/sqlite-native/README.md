# @gjsify/sqlite-native

Optional native Vala bridge over the system **libsqlite3** for GJS: a connection handle
(`GjsifySqlite.Database`), prepared statements with 1-based parameter binding
(`GjsifySqlite.Statement`), and a typed column cursor. Errors carry sqlite's **extended** result
code, so a caller can tell `SQLITE_CONSTRAINT_UNIQUE` (2067) from bare `SQLITE_CONSTRAINT` (19).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS
(GNOME JavaScript).

## What is and is not here

The bridge is deliberately thin. It exposes only what needs a C pointer — a live `sqlite3_stmt`
with its bindings and cursor — and nothing it can avoid. Everything `node:sqlite` promises on top
of that (the `DatabaseSync`/`StatementSync` surface, statement caching, JS value coercion,
`readBigInts`, the error class hierarchy) belongs to [`@gjsify/sqlite`](../sqlite) and is written
in TypeScript.

Text is UTF-8 in both directions, straight through: sqlite's native encoding is GJS's.

## Installation

This package is loaded automatically by `@gjsify/sqlite` when present.

```bash
gjsify install @gjsify/sqlite-native

# npm or yarn also work:
npm install @gjsify/sqlite-native
yarn add @gjsify/sqlite-native
```

## Usage

```typescript
import { hasNativeSqlite, loadNativeSqlite } from '@gjsify/sqlite-native';

if (hasNativeSqlite()) {
    const { Database, OpenMode, StepResult } = loadNativeSqlite()!;

    const db = Database.open(':memory:', OpenMode.READWRITE_CREATE, false);
    db.exec('CREATE TABLE t (a INTEGER PRIMARY KEY, b TEXT)');

    const insert = db.prepare('INSERT INTO t (b) VALUES (?)');
    insert.bind_text(1, 'hello');
    insert.step();
    insert.close();
    console.log(db.last_insert_rowid, db.changes);

    const select = db.prepare('SELECT b FROM t');
    while (select.step() === StepResult.ROW) {
        console.log(select.column_text(0));
    }
    db.close();
}
```

`Database.close()` finalizes every statement still open on the connection first, so closing in
either order is safe — and so is leaving both to the garbage collector, since each `Statement`
holds a strong reference to its database.

## Lifetime and naming notes

- **`Statement.close()`, not `finalize()`.** The sqlite call behind it is `sqlite3_finalize`, but
  a Vala method named `finalize` on a `GLib.Object` subclass collides with the generated
  `GObjectClass.finalize` slot, so the method carries the name every other resource type in this
  workspace uses.
- **`Database.close()` drains before it drops.** The Vala binding exposes plain `sqlite3_close`,
  which refuses a connection with outstanding statements and leaks the handle with only a
  warning. Finalizing the live statements first is what lets this bridge do without
  `sqlite3_close_v2`.

## Requirements

**libsqlite3 ≥ 3.37** — `sqlite3_changes64` is checked for at meson configure time and a older
library fails the build loudly rather than truncating a bulk `UPDATE`'s row count in silence.

`sqlite3_column_origin_name` is deliberately **not** exposed: it needs
`SQLITE_ENABLE_COLUMN_METADATA`, which macOS's system libsqlite3 is not built with, so a darwin
prebuild would link against a symbol that is not there. `column_decltype()` is available
everywhere and is what the JS layer uses.

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64`, `linux-arm64` | ✅ `.so` + `.gir` + `.typelib` | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ✅ | QEMU emulation |
| `darwin-arm64`, `darwin-x64` (macOS) | ✅ `.dylib` + `.gir` + `.typelib` | `macos-latest` / `macos-13` runner |
| Windows | ❌ | — no Vala toolchain leg |

Linux builds link the distribution's `sqlite-devel`; macOS links the libsqlite3 that ships in the
SDK, so no Homebrew formula is involved. All prebuilds are produced by
[`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml) and committed back
to the repository.

## License

MIT
