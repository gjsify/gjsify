// What a statement DOES, and the text the SQLite provider must be given for it to
// do it.
//
// WHY THIS FILE EXISTS: libgda's SQL parser does not know CTEs.
//
// `Gda.Connection.parse_sql_string()` hands a `WITH …` statement back as a statement of
// the type UNKNOWN (measured on GJS 1.88.1 + libgda 6.0.0: `SELECT 1` is SELECT,
// `PRAGMA table_info(t)` is UNKNOWN, and so is
// `WITH RECURSIVE c(x) AS (…) SELECT count(*) AS n FROM c` AND
// `WITH q AS (SELECT 1) INSERT INTO t SELECT * FROM q` — a WRITE hiding in a CTE).
// The provider renders such a statement back VERBATIM and then decides what to do with
// the text by its FIRST WORD: `SELECT`, `PRAGMA` and `EXPLAIN` are executed as a query,
// anything else as a command (`gda-sqlite-provider.c:3724`, at LIBGDA_6_0_0).
//
// So a `WITH … SELECT …` reached SQLite as a COMMAND: it was stepped once, the row it
// returned was dropped, and the step did not report SQLITE_DONE — which the provider
// turned into SQLite's message for SQLITE_OK, "not an error" (`sqlite3_errmsg()` after
// the reset that cleared the code it had compared against). Measured: `select_full`,
// `batch_execute` and `statement_execute_select` all answer "not an error" for such a
// statement, while the same query wrapped as `SELECT * FROM (WITH … SELECT …)` returns
// its row.
//
// Two questions therefore have to be answered from the SQL TEXT, because libgda's own
// answer (UNKNOWN) cannot answer either of them:
//   - does the statement return rows, or does it write? (the row-vs-rows decision)
//   - what text must the provider see for it to run as a query at all? (the first word)

import { sqlRegions } from './sql-regions.ts';

/**
 * What a statement does.
 *
 * `other` is everything this package does not read rows from and does not treat as a
 * write: a PRAGMA, a CREATE, an EXPLAIN. Those keep the path they had before — see
 * `returnsRows()` in execution.ts.
 */
export type StatementKind = 'rows' | 'write' | 'other';

/** The verbs that return rows. */
const ROW_VERBS = new Set(['SELECT', 'VALUES']);

/** The verbs that write. */
const WRITE_VERBS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE']);

/**
 * One piece of the SQL text that the classification looks at.
 *
 * A quoted region and a parameter placeholder are tokens of their own: a CTE may be
 * named `"select"`, and a parameter may be called `:select` — neither is the keyword
 * it spells.
 */
type TokenKind = 'word' | 'quoted' | 'param' | 'punct';

interface Token {
    kind: TokenKind;
    /** The word itself, the quoted text, the placeholder or the punctuation character. */
    text: string;
}

/**
 * Does this statement return rows, write, or neither?
 *
 * The answer comes from the SQL TEXT, because libgda's own classification cannot be
 * asked: a statement with a CTE is UNKNOWN to it whatever it does (see the header).
 *
 * A statement that does not start with `WITH` is classified by its first word. A
 * `WITH` statement is classified by the verb that follows its CTE definitions — the
 * CTEs themselves may hide anything, so the verb is what decides, and `WITH q AS
 * (SELECT 1) INSERT INTO t SELECT * FROM q` is a WRITE.
 */
export function statementKind(sql: string): StatementKind {
    const tokens = tokenize(sql);
    const first = tokens[0];
    if (!first || first.kind !== 'word') return 'other';

    const verb = first.text.toUpperCase() === 'WITH' ? verbAfterCtes(tokens) : first.text.toUpperCase();
    if (verb === null) return 'other';
    if (ROW_VERBS.has(verb)) return 'rows';
    if (WRITE_VERBS.has(verb)) return 'write';
    return 'other';
}

/**
 * The text the provider must be given for a statement of this kind.
 *
 * The provider dispatches on the FIRST WORD of the text it renders (see the header), so
 * a statement that returns rows but does not start with `SELECT` has to be stated in a
 * shape that does: `SELECT * FROM ( … )` — a derived table, which SQLite accepts around
 * a whole CTE statement. The rows and their column names are the inner statement's:
 * SQLite names the columns of a subquery after the ones its own SELECT produced.
 *
 * A statement that already starts with `SELECT` is handed over unchanged, and so is
 * every statement that does not return rows: a write must stay a write, and the
 * provider runs it as a command — which is what an INSERT, an UPDATE and a DELETE
 * need.
 *
 * A trailing `;` moves OUT of the parentheses: it would end the statement there and
 * leave the parenthesis unclosed ("incomplete input"). SQLite does not need it, and
 * libgda's parser drops a trailing `;` of its own accord.
 */
export function providerSql(sql: string, kind: StatementKind): string {
    if (kind !== 'rows') return sql;

    const tokens = tokenize(sql);
    const first = tokens[0];
    if (first && first.kind === 'word' && first.text.toUpperCase() === 'SELECT') return sql;

    const split = splitTrailingSemicolon(sql);
    // A line comment at the very end would swallow the closing parenthesis.
    const body = endsInsideLineComment(split.body) ? `${split.body}\n` : split.body;
    return `SELECT * FROM (${body})${split.tail}`;
}

/**
 * The verb that follows the CTE definitions of a `WITH` statement, or null when the
 * text is not shaped like one.
 *
 * The CTEs are walked, not searched for: `WITH c AS (SELECT 1), d AS (SELECT 2) SELECT
 * …` names two of them, and the verb is the word after the LAST one — a search for the
 * first `SELECT` would find the one inside the first CTE. A CTE may carry a column
 * list (`c(x)`) and a materialization hint (`AS MATERIALIZED`, `AS NOT MATERIALIZED`),
 * and both sit between the name and the body.
 *
 * Null — rather than a guess — for a text that is not shaped like a `WITH` statement:
 * a wrong `rows` would run a write as a query (and write nothing), which is far worse
 * than a statement that keeps the path it had.
 */
function verbAfterCtes(tokens: Token[]): string | null {
    let i = 1;
    if (isWord(tokens[i], 'RECURSIVE')) i++;

    for (;;) {
        // The name of the CTE.
        if (!tokens[i] || (tokens[i].kind !== 'word' && tokens[i].kind !== 'quoted')) return null;
        i++;

        // Its optional column list.
        if (isPunct(tokens[i], '(')) {
            const close = matchingParen(tokens, i);
            if (close < 0) return null;
            i = close + 1;
        }

        // The `AS` and the optional materialization hint.
        if (!isWord(tokens[i], 'AS')) return null;
        i++;
        if (isWord(tokens[i], 'NOT')) i++;
        if (isWord(tokens[i], 'MATERIALIZED')) i++;

        // The body of the CTE, in parentheses.
        if (!isPunct(tokens[i], '(')) return null;
        const close = matchingParen(tokens, i);
        if (close < 0) return null;
        i = close + 1;

        // Another CTE follows, or the verb does.
        if (isPunct(tokens[i], ',')) {
            i++;
            continue;
        }
        const verb = tokens[i];
        return verb && verb.kind === 'word' ? verb.text.toUpperCase() : null;
    }
}

/** The index of the `)` closing the `(` at `open`, or -1 when there is none. */
function matchingParen(tokens: Token[], open: number): number {
    let depth = 0;
    for (let i = open; i < tokens.length; i++) {
        if (tokens[i].kind !== 'punct') continue;
        if (tokens[i].text === '(') depth++;
        else if (tokens[i].text === ')' && --depth === 0) return i;
    }
    return -1;
}

function isWord(token: Token | undefined, word: string): boolean {
    return token !== undefined && token.kind === 'word' && token.text.toUpperCase() === word;
}

function isPunct(token: Token | undefined, punct: string): boolean {
    return token !== undefined && token.kind === 'punct' && token.text === punct;
}

/**
 * The statement without a trailing `;`, and that `;` with whatever followed it.
 *
 * A `;` inside a literal or a comment is not a statement boundary — SQLite's own
 * tokenizer does not treat it as one, and `sqlRegions()` is what says where those
 * regions end.
 */
function splitTrailingSemicolon(sql: string): { body: string; tail: string } {
    const regions = sqlRegions(sql);
    let last = -1;
    for (const region of regions) {
        if (region.kind !== 'code') continue;
        for (let i = region.start; i < region.end; i++) {
            if (sql[i] === ';') last = i;
        }
    }
    if (last < 0) return { body: sql, tail: '' };

    // What follows the `;` must be nothing but whitespace or a comment.
    for (const region of regions) {
        const from = Math.max(region.start, last + 1);
        if (from >= region.end) continue;
        if (region.kind === 'code') {
            if (sql.slice(from, region.end).trim() !== '') return { body: sql, tail: '' };
        } else if (region.kind === 'quoted') {
            return { body: sql, tail: '' };
        }
        // A comment is inert.
    }
    return { body: sql.slice(0, last), tail: sql.slice(last) };
}

/**
 * Does the text end inside a line comment?
 *
 * A line comment runs to the end of its line, so a parenthesis written after it would
 * be part of the comment.
 */
function endsInsideLineComment(sql: string): boolean {
    const regions = sqlRegions(sql);
    const last = regions[regions.length - 1];
    return last !== undefined && last.kind === 'line-comment' && last.end === sql.length;
}

/**
 * The tokens of `sql` that the classification looks at.
 *
 * A quoted region and a comment are not code: a comment is skipped entirely, and a
 * quoted region becomes one token — a CTE may be named `"select"`, and that is a name,
 * not a verb. `sqlRegions()` is what tells the two apart, and it is the same answer the
 * statement splitter and the EXISTS rewrite work from.
 */
function tokenize(sql: string): Token[] {
    const tokens: Token[] = [];

    for (const region of sqlRegions(sql)) {
        if (region.kind === 'quoted') {
            tokens.push({ kind: 'quoted', text: sql.slice(region.start, region.end) });
            continue;
        }
        if (region.kind !== 'code') continue;

        let i = region.start;
        while (i < region.end) {
            const ch = sql[i];

            if (isSpace(ch)) {
                i++;
                continue;
            }

            // A libgda holder placeholder: `##id::type`. The id may be a name that
            // spells a keyword, so the whole placeholder is one token.
            if (ch === '#' && sql[i + 1] === '#') {
                const end = placeholderEnd(sql, i, region.end);
                tokens.push({ kind: 'param', text: sql.slice(i, end) });
                i = end;
                continue;
            }

            // A parameter: `?`, `?NNN`, `:name`, `$name`, `@name`.
            if (ch === '?') {
                let end = i + 1;
                while (end < region.end && sql[end] >= '0' && sql[end] <= '9') end++;
                tokens.push({ kind: 'param', text: sql.slice(i, end) });
                i = end;
                continue;
            }
            if ((ch === ':' || ch === '$' || ch === '@') && isNameStart(sql[i + 1])) {
                let end = i + 1;
                while (end < region.end && isNamePart(sql[end])) end++;
                tokens.push({ kind: 'param', text: sql.slice(i, end) });
                i = end;
                continue;
            }

            if (isNameStart(ch)) {
                let end = i + 1;
                while (end < region.end && isNamePart(sql[end])) end++;
                tokens.push({ kind: 'word', text: sql.slice(i, end) });
                i = end;
                continue;
            }

            tokens.push({ kind: 'punct', text: ch });
            i++;
        }
    }

    return tokens;
}

/** The end of a `##id::type` placeholder that starts at `start`. */
function placeholderEnd(sql: string, start: number, limit: number): number {
    let i = start + 2;
    while (i < limit && isNamePart(sql[i])) i++;
    if (sql[i] === ':' && sql[i + 1] === ':') {
        i += 2;
        while (i < limit && isNamePart(sql[i])) i++;
    }
    return i;
}

function isSpace(ch: string | undefined): boolean {
    return ch !== undefined && /\s/.test(ch);
}

function isNameStart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isNamePart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}
