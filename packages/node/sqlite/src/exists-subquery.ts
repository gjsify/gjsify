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
 * The cause is two parentheses round the sub-SELECT. A function argument that is a
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

const EXISTS = 'EXISTS';

/** A case-insensitive `includes`. No `g` flag, so there is no `lastIndex` to reset. */
const MENTIONS_EXISTS = /exists/i;

/**
 * A position in the SQL plus the region it sits in. Both are carried together because
 * every step of the scan is "advance to the next region, or to the next character of this
 * one", and re-deriving the region by searching the list each time would make the scan
 * quadratic in the number of literals and comments.
 */
interface Cursor {
    at: number;
    region: number;
}

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
 * identifier and a comment. A comment BETWEEN the keyword and its parenthesis counts as
 * nothing at all, because SQLite's own tokenizer skips it there — `EXISTS -- c\n(SELECT …)`
 * is ONE statement and has to be rewritten as one. An `EXISTS` not followed by a `(` — a
 * column, a longer identifier ending in it, prose in a comment — is left alone, as is an
 * unterminated `(`, which is a syntax error libgda should report in its own words.
 *
 * The cost of the IN form, recorded so it is not "optimised" away: SQLite materialises `S`
 * into an ephemeral index (a `LIST SUBQUERY` scan with a bloom filter, measured on 100k
 * rows) where `EXISTS` stops at the first row, and `LIMIT 1` on `S` does NOT bring that
 * plan back (measured). The faster scalar restatement, `(SELECT 1 FROM (S) LIMIT 1) = 1`,
 * answers NULL instead of 0 in a projection when `S` is empty (measured) — so the IN form
 * is the one that is correct in every position.
 */
export function rewriteExistsSubqueries(sql: string): string {
    // Every prepare/run/get/all calls this, and almost no statement names the keyword, so
    // the common answer is one substring test that never reaches the scanner. Deliberately
    // LOOSE: a false positive costs the scan below, which then rewrites nothing and hands
    // back the very string it was given.
    if (!MENTIONS_EXISTS.test(sql)) return sql;

    const regions = sqlRegions(sql);
    const out: string[] = [];
    let copiedTo = 0;
    const cursor: Cursor = { at: 0, region: 0 };

    while (cursor.at < sql.length) {
        seekToCode(sql, regions, cursor);
        if (cursor.at >= sql.length) break;

        const start = cursor.at;
        if (isExistsAt(sql, regions, cursor)) {
            const open = openParenAfter(sql, regions, cursor);
            const close = open < 0 ? -1 : matchingParen(sql, regions, open);
            if (close >= 0) {
                out.push(sql.slice(copiedTo, start), '(1 IN (SELECT 1 FROM (');
                out.push(rewriteExistsSubqueries(sql.slice(open + 1, close)));
                out.push(')))');
                copiedTo = close + 1;
                cursor.at = close + 1;
                continue;
            }
        }
        cursor.at = start + 1;
    }

    if (copiedTo === 0) return sql;
    out.push(sql.slice(copiedTo));
    return out.join('');
}

/**
 * Advance `cursor` to the next character that is CODE, or to the end of the SQL.
 *
 * A comment region is stepped over whole — a `--` comment ends before its newline, so the
 * newline it terminates is found as code on the next step.
 */
function seekToCode(sql: string, regions: SqlRegion[], cursor: Cursor): void {
    while (cursor.at < sql.length) {
        while (cursor.region < regions.length - 1 && regions[cursor.region].end <= cursor.at) cursor.region++;
        if (regions[cursor.region].kind === 'code') return;
        cursor.at = regions[cursor.region].end;
    }
}

/**
 * Is `EXISTS` the whole word at `cursor`, followed by a parenthesis?
 *
 * The character before it decides the first part: a letter, digit, `_` or `$` means the
 * word is only the tail of a longer identifier (`my_exists(x)`).
 */
function isExistsAt(sql: string, regions: SqlRegion[], cursor: Cursor): boolean {
    const at = cursor.at;
    if (sql.slice(at, at + EXISTS.length).toUpperCase() !== EXISTS) return false;
    if (at > 0 && /[A-Za-z0-9_$]/.test(sql[at - 1])) return false;
    return openParenAfter(sql, regions, cursor) >= 0;
}

/**
 * The index of the `(` that opens the sub-SELECT of the `EXISTS` at `cursor`, or -1.
 *
 * Whitespace and comments may sit between the keyword and the parenthesis: a comment is
 * not a token, so `EXISTS` followed by a block comment and `(SELECT …)` is ONE statement
 * whose sub-SELECT is right there. Anything else means this `EXISTS` opens no sub-SELECT,
 * and the caller moves on.
 */
function openParenAfter(sql: string, regions: SqlRegion[], cursor: Cursor): number {
    let at = cursor.at + EXISTS.length;
    let region = cursor.region;

    while (at < sql.length) {
        while (region < regions.length - 1 && regions[region].end <= at) region++;
        const here = regions[region];
        if (here.kind === 'code') {
            if (sql[at] === '(') return at;
            if (!/\s/.test(sql[at])) return -1;
            at++;
        } else {
            at = here.end;
        }
    }
    return -1;
}

/**
 * The `)` closing the `(` at `open`, or -1 if the input runs out first.
 *
 * Only code counts: a `)` inside a literal does not close anything, and neither do the
 * parentheses inside a comment.
 */
function matchingParen(sql: string, regions: SqlRegion[], open: number): number {
    let depth = 0;
    const cursor: Cursor = { at: open, region: 0 };
    while (cursor.at < sql.length) {
        seekToCode(sql, regions, cursor);
        if (cursor.at >= sql.length) break;
        const ch = sql[cursor.at];
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) return cursor.at;
        cursor.at++;
    }
    return -1;
}
