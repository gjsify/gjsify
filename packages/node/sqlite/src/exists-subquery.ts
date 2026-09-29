// `EXISTS (SELECT …)`, restated in a form libgda's renderer can hand to SQLite.

import { sqlRegions, type SqlRegion } from './sql-regions.ts';

/**
 * Why this file exists: libgda does not execute the SQL text it was given.
 *
 * `Gda.Connection.parse_sql_string()` turns that text into a `GdaSqlStatement` tree, and
 * the SQLite provider re-renders the tree and passes the RENDER to `sqlite3_prepare_v2()`
 * (`libgda/sqlite/gda-sqlite-provider.c:2928`, fed by `real_prepare()` at :2896). So a
 * statement can parse and still be rejected downstream — by SQLite, on SQL that Node
 * accepts. `EXISTS (SELECT …)` was exactly that: `near "(": syntax error`.
 *
 * The cause is two parenthesis round the sub-SELECT. A function argument that is a
 * sub-SELECT is parenthesised once by the expression renderer
 * (`sqlite_render_expr()`, `libgda/sqlite/gda-sqlite-provider.c:2698`, and its
 * `default_render_expr()` twin at `libgda/gda-statement.c:1615` — each wraps the
 * sub-SELECT when the expression's `parent` is not the function), and a second time by
 * the function renderer, which parenthesises any argument whose `select` is set
 * (`default_render_function()`, `libgda/gda-statement.c:1735`). Measured on
 * GJS 1.88.1 + libgda 6.0.0, `stmt.to_sql_extended()` returns
 * `SELECT EXISTS ((SELECT 1 FROM l))` for `SELECT EXISTS (SELECT 1 FROM l)`, and
 * `sqlite3` 3.51.2 answers that text with `near "(": syntax error` at the inner `(`.
 *
 * The parser is the other half. The grammar has a rule that gets this right —
 * `expr ::= fullname LP compound RP` (`libgda/sql-parser/parser.y:786`) builds the
 * sub-SELECT expression with the FUNCTION as its parent, which is the one case the
 * expression renderer leaves alone. It cannot match, because it wants the sub-SELECT
 * unparenthesized, i.e. `EXISTS SELECT 1 FROM l` — a form SQLite rejects in turn
 * (`near "SELECT": syntax error`). What parses instead is `LP compound RP` at
 * `parser.y:871`, which builds the same expression with `gda_sql_expr_new (NULL)`.
 *
 * So the fix cannot be "make libgda parent it correctly" and cannot be "don't re-render":
 * every execution path in `gda-connection.c` parses into the tree first, so the original
 * text is never available to the provider. What is left is to state the predicate in a
 * shape the tree CAN carry — see `rewriteExistsSubqueries()`.
 */

/**
 * `EXISTS (S)` → `(1 IN (SELECT 1 FROM (S)))`, for every `EXISTS (` in `sql`.
 *
 * Equivalent by construction: the derived table `S` yields one row per row of `S` and
 * every one of them holds the constant `1`, so `1 IN (…)` is true exactly when `S` yields
 * a row — which is what `EXISTS (S)` means. The derived table is what makes that
 * independent of what `S` projects; `1 IN (S)` on its own would only agree while `S`
 * already projected the constant 1. The `IN` form is the one construct libgda renders
 * correctly: an operation operand that is a sub-SELECT gets ONE pair of parentheses,
 * from `default_render_operation()`, which marks the operand composed rather than
 * parenthesising it a second time.
 *
 * The outer parentheses keep `NOT` and `AND`/`OR` bound to the predicate the caller
 * wrote: without them `NOT EXISTS (S)` would become `NOT 1 IN (…)`, which SQL reads the
 * same way but which no longer looks like the subquery the caller passed.
 *
 * `S` is copied byte for byte, so every parameter, literal and identifier inside it keeps
 * its position and its text — which is what keeps the holders this package binds
 * (`Gda.Set`) lined up with the `?` placeholders of the rendered statement.
 *
 * A nested `EXISTS` inside `S` is rewritten too, and only occurrences in CODE are
 * touched: `sqlRegions()` is what keeps the word out of a string literal, a quoted
 * identifier and a comment. An `EXISTS` not followed by a `(` — a column, a function of
 * another name ending in it, prose in a comment — is left alone, as is an unterminated
 * `(`, which is a syntax error libgda should report in its own words.
 */
export function rewriteExistsSubqueries(sql: string): string {
    const regions = sqlRegions(sql);
    const out: string[] = [];
    let copiedTo = 0;
    let region = 0;

    for (let i = 0; i < sql.length; i++) {
        while (region < regions.length - 1 && regions[region].end <= i) region++;
        if (regions[region].kind !== 'code') continue;
        if (!isExistsAt(sql, i, regions)) continue;

        const open = openParenAfter(sql, i + EXISTS.length, regions);
        const close = open < 0 ? -1 : matchingParen(sql, open, regions);
        if (close < 0) continue;

        const subquery = rewriteExistsSubqueries(sql.slice(open + 1, close));
        out.push(sql.slice(copiedTo, i), '(1 IN (SELECT 1 FROM (', subquery, ')))');
        copiedTo = close + 1;
        i = close;
    }

    if (copiedTo === 0) return sql;
    out.push(sql.slice(copiedTo));
    return out.join('');
}

const EXISTS = 'EXISTS';

/** Is `EXISTS` the whole word starting at `at`? The character before it decides. */
function isExistsAt(sql: string, at: number, regions: SqlRegion[]): boolean {
    if (sql.slice(at, at + EXISTS.length).toUpperCase() !== EXISTS) return false;
    // `my_exists(x)`: a letter, digit, `_` or `$` in front means EXISTS is only the tail
    // of a longer identifier.
    if (at > 0 && /[A-Za-z0-9_$]/.test(sql[at - 1])) return false;
    return openParenAfter(sql, at + EXISTS.length, regions) >= 0;
}

/** The index of the `(` after `from`, or -1. Whitespace may separate them. */
function openParenAfter(sql: string, from: number, regions: SqlRegion[]): number {
    let i = from;
    while (i < sql.length && /\s/.test(sql[i])) i++;
    return sql[i] === '(' && inCode(regions, i) ? i : -1;
}

/**
 * The `)` closing the `(` at `open`, or -1 if the input runs out first.
 *
 * Only code counts: a `)` inside a literal does not close anything, and a `[` opens a
 * bracket identifier whose `]` is not a paren.
 */
function matchingParen(sql: string, open: number, regions: SqlRegion[]): number {
    let depth = 0;
    for (let i = open; i < sql.length; i++) {
        if (!inCode(regions, i)) continue;
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

function inCode(regions: SqlRegion[], at: number): boolean {
    return regions.some((r) => r.kind === 'code' && at >= r.start && at < r.end);
}
