// The one way to walk SQL text without mistaking a quoted region or a comment for code.
//
// Two callers in this package need it and must not drift apart: `DatabaseSync.sqlExec()`
// splits statements on a top-level `;` and would cut inside `'…'` if it did not know
// where a literal ends, and `rewriteExistsSubqueries()` must not read the word EXISTS out
// of a literal or count a `)` that a literal happens to contain. Both answers come from
// SQLite's tokenizer, which is also where the rules below are taken from: `'…'`, `"…"`
// and `` `…` `` escape their delimiter by doubling it, `[ … ]` has no escape at all
// (the first `]` ends it), and a `/* … */` block comment is not nestable.

/**
 * What a stretch of the SQL text is. Only `code` is parsed; the other three are inert
 * bytes that must be copied through untouched.
 */
export type SqlRegionKind = 'code' | 'quoted' | 'line-comment' | 'block-comment';

export interface SqlRegion {
    kind: SqlRegionKind;
    /** Index of the first character, and one past the last. */
    start: number;
    end: number;
}

/**
 * Split `sql` into alternating code and inert regions, in source order and covering it
 * exactly — the first and last are always `code`, and a region is never empty.
 *
 * A line comment ends BEFORE its terminating newline, so that newline lands in the
 * following code region: removing the comment must leave the line break that separates
 * two statements.
 *
 * An unterminated quoted region or comment runs to the end of the input, which is what
 * SQLite's own tokenizer does with the same input.
 */
export function sqlRegions(sql: string): SqlRegion[] {
    const regions: SqlRegion[] = [];
    let codeStart = 0;
    let i = 0;

    while (i < sql.length) {
        const start = i;
        const ch = sql[i];
        let kind: SqlRegionKind = 'quoted';

        if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
            const close = ch === '[' ? ']' : ch;
            const doubled = ch !== '[';
            i++;
            while (i < sql.length) {
                if (sql[i] === close) {
                    if (doubled && sql[i + 1] === close) {
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                i++;
            }
        } else if (ch === '-' && sql[i + 1] === '-') {
            kind = 'line-comment';
            i += 2;
            while (i < sql.length && sql[i] !== '\n') i++;
        } else if (ch === '/' && sql[i + 1] === '*') {
            kind = 'block-comment';
            i += 2;
            while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
            i = i < sql.length ? i + 2 : sql.length;
        } else {
            i++;
            continue;
        }

        if (start > codeStart) regions.push({ kind: 'code', start: codeStart, end: start });
        regions.push({ kind, start, end: i });
        codeStart = i;
    }

    if (codeStart < sql.length) regions.push({ kind: 'code', start: codeStart, end: sql.length });
    return regions;
}
