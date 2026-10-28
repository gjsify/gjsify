# 123. `node:sqlite` runs on libsqlite3 through a Vala bridge, not on libgda

- Status: **Accepted** (2026-10-28)
- Date: 2026-10-28
- Deciders: Pascal Garber
- Related: [ADR 0017](0017-native-package-distribution.md) (the per-target prebuild package),
  [ADR 0021](0021-launcher-free-prebuild-resolution.md) (how the typelib is found);
  `packages/node/sqlite`, `packages/node/sqlite-native`; issue #2427 (the track), #2418
  (`StatementSync.iterate()`)

## Context

`@gjsify/sqlite` implemented `node:sqlite` over libgda's SQLite provider
(`gi://Gda?version=6.0`), because libgda is the GNOME database library that ships a GIR and
SQLite is one of its providers. It is the wrong layer, and the reason is structural rather than
a list of bugs: **libgda does not execute the SQL text it is given.**
`gda_connection_parse_sql_string()` parses the text into a `GdaSqlStatement` tree, and the
provider RE-RENDERS that tree back into text for `sqlite3_prepare_v2()`
(`libgda/sqlite/gda-sqlite-provider.c:2928` at LIBGDA_6_0_0). A result set is a `GdaDataModel` —
materialised, not a cursor — and a parameter is a `GdaHolder` carrying a `GValue`.

So every statement had to survive a parse and a re-render by a parser that is not SQLite's, and
`node:sqlite`'s surface (BLOB columns, prepared-statement binding by index, extended result
codes, row-at-a-time stepping) had no spelling underneath. Four findings were measured against
that provider and carried a workaround in this repo. They are recorded here because the
workarounds are deleted with this ADR and `status/upstream-patch-candidates.md` only holds
workarounds we still maintain — the measurements remain true of libgda 6.0.0 and are worth
keeping for anyone who reaches for it again.

1. **A closed SQLite connection leaves a dangling `GWeakRef` on the process-wide provider.**
   `gda_sqlite_provider_open_connection()` does `g_weak_ref_init (&cdata->provider, prov)`
   (`gda-sqlite-provider.c:1210`); the teardown ends in a bare `g_free (cdata)` with no
   `g_weak_ref_clear` (same file, :4291). GLib ≥ 2.80 keeps an object's GWeakRefs in a list on
   the object, and the provider is a session-wide singleton, so the freed slot stays registered.
   Measured on GJS 1.88.1 + libgda 6.0.0 + GLib 2.90.0 (arm64 macOS): the SECOND connection
   aborts with `_weak_ref_set: assertion failed: (weak_ref_data_list_find (new_wrdata, weak_ref)
   < 0)`; where that assertion is compiled out (Fedora's GLib) the list instead grows one entry
   per closed connection until `Too many GWeakRef registered` at 65535, after which reads answer
   `fuzzy_get_gtype: assertion 'prov != NULL' failed`; and a provider that has had a connection
   closed can never be destroyed. The workaround was to never close one — `connection-pool.ts`
   handed every `DatabaseSync.close()` to a process-wide pool. Upstream fix: one
   `g_weak_ref_clear (&cdata->provider)` before the `g_free`, worth auditing in the other
   providers that embed a `GWeakRef` in their connection data.
2. **A sub-SELECT as a function argument is parenthesised twice.** The expression renderer wraps
   it (`sqlite_render_expr()`, :2698) and the function renderer wraps it again for any argument
   whose `select` is set (`default_render_function()`, `gda-statement.c:1735`), so
   `SELECT EXISTS (SELECT 1 FROM l)` renders as `SELECT EXISTS ((SELECT 1 FROM l))` and
   sqlite3 3.51.2 answers `near "(": syntax error`. `IN (SELECT …)`, a scalar subquery and
   `CAST((SELECT …) AS x)` all render correctly — none of them puts a sub-SELECT in a function
   argument. The workaround (`exists-subquery.ts`) restated `EXISTS (S)` as
   `(1 IN (SELECT 1 FROM (S)))`.
3. **`Gda.SqlParser.parse_string()` corrupts the heap on a `/* … */` block comment.**
   `parser.parse_string('/* c */ CREATE TABLE b(y TEXT)')` aborts the GJS process with
   `free(): invalid pointer`; a `--` line comment parses fine. The workaround stripped block
   comments in the statement splitter, which made the crash unreachable from the public API and
   permanently blocked letting libgda do the tokenising.
4. **Statement kind is decided by the first word of the rendered text, and the grammar has no
   CTE.** `SELECT`, `PRAGMA` and `EXPLAIN` are queries, anything else is a command; a `WITH …`
   statement parses as UNKNOWN and is rendered back verbatim, so `WITH … SELECT …` was stepped
   once as a command, its row dropped, and the result reported as SQLite's message for
   `SQLITE_OK` — "not an error" — because `sqlite3_errmsg()` is read AFTER the
   `sqlite3_reset()` that cleared the code. `WITH q AS (…) INSERT …` is UNKNOWN too, so libgda
   cannot be asked whether a statement writes. The workaround wrapped row-returning non-`SELECT`
   statements as `SELECT * FROM ( … )` and decided the kind from the SQL text itself
   (`statement-kind.ts`).

## Decision

1. **`@gjsify/sqlite` binds the system `libsqlite3` directly**, through a new
   `@gjsify/sqlite-native` — a Vala/GObject library introspected as
   `gi://GjsifySqlite?version=1.0`. libgda leaves the package entirely.
2. **The native library is deliberately thin: it is the C API and nothing else.** `Database`
   (open/exec/prepare/close, `last_insert_rowid`, `changes`, `is_open`, `in_transaction`) and
   `Statement` (bind by index, parameter index/count/name, `step()` → ROW/DONE, reset,
   `clear_bindings`, column count/name/type/int64/double/text/blob-as-`GLib.Bytes`,
   `sql`/`expanded_sql`, `decltype`, `close`). It holds **no Node semantics**.
3. **Every Node semantic stays in `@gjsify/sqlite`**, in TypeScript: named and bare named
   parameters, `allowUnknownNamedParameters`, the typed readers and `readBigInts`,
   `returnArrays`, the `ERR_SQLITE_ERROR` shape with `errcode`/`errstr`, `sourceSQL` /
   `expandedSQL`. This is what makes the four findings above unreachable rather than worked
   around: the SQL text reaches sqlite3 unrewritten, and a value travels as a bound parameter,
   so nothing splices a JS value into SQL on its way to a column.
4. **Lifetime is owned by the native side, because GC order is not ours.** A `Statement` holds a
   strong ref to its `Database`; the `Database` tracks its live statements and finalizes every
   one inside `close()`. Closing the database first therefore cannot leave SpiderMonkey a
   dangling `sqlite3_stmt` to finalize — a statement used after that raises `SQLITE_MISUSE`
   instead of crashing.
5. **One error type carries the EXTENDED result code**, so a constraint violation is
   distinguishable (`SQLITE_CONSTRAINT_PRIMARYKEY` = 1555) without a second call.

## Consequences

- The nine libgda-era modules are deleted: the connection pool, the statement splitter, the SQL
  region scanner, the parameter-syntax rewriter, the `EXISTS` rewriter, the statement-kind
  scanner, the parser wrapper, the data-model reader and the execution layer.
- The four rows above leave `status/upstream-patch-candidates.md`; this ADR is their record.
  None of them was ever filed upstream.
- BLOB columns, row-at-a-time stepping and `StatementSync.iterate()` (#2418) become expressible;
  a 10 000-row read of 3 KiB BLOBs no longer materialises a `GdaDataModel` first.
- A new native dependency: `@gjsify/sqlite-native` needs a prebuild per target, distributed per
  ADR 0017 and resolved per ADR 0021. Vala 0.56's bundled `sqlite3.vapi` is missing four symbols
  (`changes64`, `extended_errcode`, `errstr`, `column_decltype`), declared in a local compat
  vapi; meson asserts `sqlite3_changes64` at configure time, so a libsqlite3 older than 3.37
  fails at build rather than at run time.
- `sqlite3_column_origin_name` is deliberately NOT exposed: it needs
  `SQLITE_ENABLE_COLUMN_METADATA`, which macOS's system libsqlite3 is built without.
- The darwin runtime bundle still carries libgda and its SQLite provider, and the CI formulae
  still install it. Removing that payload is the remaining step of #2427 and is not part of this
  ADR.
- One Node divergence is known and open: `prepare()` on whitespace- or comment-only SQL throws
  `the SQL text contains no statement`, where Node returns a statement whose methods report
  `statement has been finalized`.
