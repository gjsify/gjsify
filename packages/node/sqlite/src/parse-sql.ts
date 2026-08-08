// The one sanctioned way to turn SQL text into a Gda.Statement.
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import type Gda from '@girs/gda-6.0';
import { SqliteError } from './errors.ts';

/**
 * Parse a single SQL statement and return it with its parameter set.
 *
 * **Never call `Gda.SqlParser.parse_string()` in this package.** Its `remain`
 * out-parameter points INTO the SQL string that was passed in — it is the unparsed tail,
 * not an allocation — but `Gda-6.0.gir` declares it `transfer-ownership="full"`:
 *
 * ```xml
 * <parameter name="remain" direction="out" transfer-ownership="full" nullable="1">
 *   <type name="utf8" c:type="const gchar**"/>
 * ```
 *
 * So whenever libgda stops before the end of the string, GJS calls `g_free()` on an
 * interior pointer at call teardown and glibc aborts the process: `free(): invalid
 * pointer`, SIGABRT, no JS exception, no return value. Nothing can catch it and nothing
 * can be checked first — asking for the parse IS the crash. A block comment does it; so
 * does a statement whose string literal libgda thinks ends elsewhere than SQLite does
 * (libgda honours `\` as an escape inside `'…'`, SQLite does not — which is how a mail
 * body ending in a backslash killed a consumer mid-import).
 *
 * `gda_connection_parse_sql_string()` takes no `remain` at all, so the same input raises
 * an ordinary catchable error. It also hands back the `Gda.Set` of parameter holders,
 * which is what lets values be BOUND instead of spliced into the SQL text.
 */
export function parseSql(connection: Gda.Connection, sql: string): [Gda.Statement, Gda.Set | null] {
    const [stmt, params] = connection.parse_sql_string(sql);
    if (!stmt) {
        throw new SqliteError('Failed to parse SQL statement');
    }
    return [stmt, params];
}
