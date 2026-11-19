// A SQL lexer just big enough for the two jobs androidx.sqlite leaves to us (ADR 0147):
// finding the bind parameters of a statement and cutting a script into statements.
// It is not a parser. It knows what SQLite's own tokenizer knows about *where text ends*:
// strings, quoted identifiers and comments. Nothing inside those is a parameter or a `;`.

type TokenKind = 'word' | 'string' | 'ident' | 'param' | 'semi' | 'other';

interface Token {
    kind: TokenKind;
    text: string;
    start: number;
    end: number;
}

const isWordStart = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 128;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isWordPart = (c: number) => isWordStart(c) || isDigit(c) || c === 36;

/** Index just past the closing `quote`, where a doubled quote is an escaped one. */
function endOfQuoted(sql: string, start: number, quote: string): number {
    let i = start + 1;
    while (i < sql.length) {
        if (sql[i] === quote) {
            if (sql[i + 1] === quote) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i++;
    }
    return sql.length; // unterminated: SQLite reports it, we just stop
}

function* tokenize(sql: string): Generator<Token> {
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const ch = sql[i];
        const code = sql.charCodeAt(i);
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
            i++;
        } else if (ch === '-' && sql[i + 1] === '-') {
            const nl = sql.indexOf('\n', i);
            i = nl < 0 ? n : nl + 1;
        } else if (ch === '/' && sql[i + 1] === '*') {
            const close = sql.indexOf('*/', i + 2);
            i = close < 0 ? n : close + 2;
        } else if (ch === "'") {
            const end = endOfQuoted(sql, i, "'");
            yield { kind: 'string', text: sql.slice(i, end), start: i, end };
            i = end;
        } else if (ch === '"' || ch === '`') {
            const end = endOfQuoted(sql, i, ch);
            yield { kind: 'ident', text: sql.slice(i, end), start: i, end };
            i = end;
        } else if (ch === '[') {
            const close = sql.indexOf(']', i + 1);
            const end = close < 0 ? n : close + 1;
            yield { kind: 'ident', text: sql.slice(i, end), start: i, end };
            i = end;
        } else if (ch === ';') {
            yield { kind: 'semi', text: ';', start: i, end: i + 1 };
            i++;
        } else if (ch === '?') {
            let j = i + 1;
            while (j < n && isDigit(sql.charCodeAt(j))) j++;
            yield { kind: 'param', text: sql.slice(i, j), start: i, end: j };
            i = j;
        } else if ((ch === ':' || ch === '@' || ch === '$') && i + 1 < n && isWordPart(sql.charCodeAt(i + 1))) {
            let j = i + 1;
            while (j < n && isWordPart(sql.charCodeAt(j))) j++;
            yield { kind: 'param', text: sql.slice(i, j), start: i, end: j };
            i = j;
        } else if (isWordStart(code) || isDigit(code)) {
            let j = i + 1;
            while (j < n && isWordPart(sql.charCodeAt(j))) j++;
            yield { kind: 'word', text: sql.slice(i, j), start: i, end: j };
            i = j;
        } else {
            yield { kind: 'other', text: ch, start: i, end: i + 1 };
            i++;
        }
    }
}

/**
 * The bind parameters of ONE statement, numbered the way SQLite numbers them.
 *
 * Index `i` (1-based) is at position `i - 1`; the value is the parameter's full name
 * (`:a`, `@a`, `$a`, `?NNN`) or null for an anonymous `?`. The array length is
 * `sqlite3_bind_parameter_count()`. A name used twice is one parameter; `?NNN` can leave
 * gaps, which read as null like SQLite's own.
 */
export function scanParameters(sql: string): (string | null)[] {
    const slots: (string | null)[] = [];
    const byName = new Map<string, number>();
    for (const token of tokenize(sql)) {
        if (token.kind !== 'param') continue;
        const text = token.text;
        if (text === '?') {
            slots.push(null);
        } else if (text[0] === '?') {
            const index = Number(text.slice(1));
            if (index < 1) continue;
            while (slots.length < index) slots.push(null);
            slots[index - 1] = text;
        } else if (!byName.has(text)) {
            slots.push(text);
            byName.set(text, slots.length);
        }
    }
    return slots;
}

/**
 * Cut a script into its statements, the way `sqlite3_exec()` walks it.
 *
 * Empty and comment-only pieces are dropped (the C API prepares those to a null
 * statement; androidx would throw). `CREATE [TEMP] TRIGGER … BEGIN … END` is one
 * statement although its body is full of `;`; a `CASE … END` inside it does not close it.
 */
export function splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let first: Token | null = null;
    let last: Token | null = null;
    let words: string[] = [];
    let trigger = false;
    let inBody = false;
    let caseDepth = 0;

    const flush = () => {
        if (first && last) statements.push(sql.slice(first.start, last.end));
        first = last = null;
        words = [];
        trigger = false;
        inBody = false;
        caseDepth = 0;
    };

    for (const token of tokenize(sql)) {
        if (token.kind === 'semi') {
            if (inBody) {
                last = token;
                continue;
            }
            flush();
            continue;
        }
        first ??= token;
        last = token;
        if (token.kind !== 'word') continue;
        const word = token.text.toUpperCase();
        if (words.length < 3) {
            words.push(word);
            const head = words[0] === 'CREATE' ? words.slice(1) : [];
            if (head[0] === 'TRIGGER' || ((head[0] === 'TEMP' || head[0] === 'TEMPORARY') && head[1] === 'TRIGGER')) {
                trigger = true;
            }
        }
        if (!trigger) continue;
        if (!inBody) {
            if (word === 'BEGIN') inBody = true;
        } else if (word === 'CASE') {
            caseDepth++;
        } else if (word === 'END') {
            if (caseDepth > 0) caseDepth--;
            else inBody = false;
        }
    }
    flush();
    return statements;
}
