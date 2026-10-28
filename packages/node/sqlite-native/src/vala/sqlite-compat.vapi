/*
 * sqlite-compat.vapi — the libsqlite3 entry points Vala 0.56's bundled
 * `sqlite3.vapi` does not declare.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * `sqlite3.vapi` ships with Vala and covers most of the C API, but it was
 * written against sqlite 3.4 and has not tracked every addition since. Four
 * symbols this bridge needs are missing from it, and each has a reason it
 * cannot be worked around:
 *
 *   • sqlite3_changes64        — the vapi only has `changes()`, which returns
 *                                `int`. `node:sqlite` reports `changes` as a
 *                                BigInt-capable count, so truncating at 2^31
 *                                would be a silent wrong answer on a bulk
 *                                UPDATE. Added in sqlite 3.37 (2021-11).
 *   • sqlite3_extended_errcode — `errcode()` answers the PRIMARY result code
 *                                (19 = SQLITE_CONSTRAINT) regardless of
 *                                `extended_result_codes()`. Node reports the
 *                                extended one (2067 = …_CONSTRAINT_UNIQUE) on
 *                                `err.errcode`, and the JS layer can only
 *                                build that if it travels out of here intact.
 *   • sqlite3_errstr           — the only way to describe a result code when
 *                                there is no connection to ask (an open that
 *                                failed before a handle existed).
 *   • sqlite3_column_decltype  — declared column type, needed so the JS layer
 *                                can apply sqlite's type affinity rules.
 *
 * NOT declared here, deliberately: `sqlite3_column_origin_name`. It exists
 * only in a libsqlite3 built with SQLITE_ENABLE_COLUMN_METADATA, which the
 * macOS system library is not. Referencing it would link on Fedora and leave
 * the darwin prebuild with an undefined symbol — found by GI, refused by the
 * loader, which docs/prebuilds.md calls out as the silent failure mode.
 *
 * `sqlite3_close_v2` is likewise absent: {@link GjsifySqlite.Database.close}
 * finalizes every live statement before it drops the handle, so the plain
 * `sqlite3_close` the vapi already binds as the compact class's free function
 * never meets an outstanding statement.
 */

[CCode (cheader_filename = "sqlite3.h")]
namespace GjsifySqliteCompat {

    /**
     * Rows modified by the most recent statement, as int64.
     *
     * sqlite >= 3.37. The build asserts its presence at configure time rather
     * than letting the link fail (see meson.build).
     */
    [CCode (cname = "sqlite3_changes64")]
    public int64 changes64 (Sqlite.Database db);

    /**
     * The EXTENDED result code of the most recent failed call on @db — the
     * value `node:sqlite` surfaces as `err.errcode`.
     */
    [CCode (cname = "sqlite3_extended_errcode")]
    public int extended_errcode (Sqlite.Database db);

    /**
     * English text for a result code, with no connection involved.
     *
     * The string is owned by libsqlite3 and is valid for the process lifetime.
     */
    [CCode (cname = "sqlite3_errstr")]
    public unowned string errstr (int result_code);

    /**
     * Declared type of a result column as written in the CREATE TABLE
     * statement, or %null for an expression column.
     *
     * The string is owned by the statement and is invalidated by
     * `sqlite3_finalize`; callers copy before returning it.
     */
    [CCode (cname = "sqlite3_column_decltype")]
    public unowned string? column_decltype (Sqlite.Statement stmt, int column);
}
