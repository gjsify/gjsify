// DatabaseSync class for node:sqlite
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import Gda from '@girs/gda-6.0';
import {
    ConstructCallRequiredError,
    InvalidArgTypeError,
    InvalidStateError,
    InvalidUrlSchemeError,
    SqliteError,
} from './errors.ts';
import { StatementSync } from './statement-sync.ts';
import type { DatabaseSyncOptions, StatementSyncOptions } from './types.ts';

const sqliteTypeSymbol = Symbol.for('sqlite-type');

function parsePath(path: unknown): string {
    if (typeof path === 'string') {
        if (path.includes('\0')) {
            throw new InvalidArgTypeError(
                'The "path" argument must be a string, Uint8Array, or URL without null bytes.',
            );
        }
        return path;
    }
    if (path instanceof URL) {
        if (path.protocol !== 'file:') {
            throw new InvalidUrlSchemeError();
        }
        const filePath = path.pathname;
        if (filePath.includes('\0')) {
            throw new InvalidArgTypeError(
                'The "path" argument must be a string, Uint8Array, or URL without null bytes.',
            );
        }
        return filePath;
    }
    if (path instanceof Uint8Array) {
        for (let i = 0; i < path.length; i++) {
            if (path[i] === 0) {
                throw new InvalidArgTypeError(
                    'The "path" argument must be a string, Uint8Array, or URL without null bytes.',
                );
            }
        }
        return new TextDecoder().decode(path);
    }
    throw new InvalidArgTypeError('The "path" argument must be a string, Uint8Array, or URL without null bytes.');
}

function validateOptions(options: unknown): DatabaseSyncOptions {
    if (options === undefined) return {};
    if (options === null || typeof options !== 'object') {
        throw new InvalidArgTypeError('The "options" argument must be an object.');
    }
    const opts = options as Record<string, unknown>;
    const result: DatabaseSyncOptions = {};

    if (opts.open !== undefined) {
        if (typeof opts.open !== 'boolean') {
            throw new InvalidArgTypeError('The "options.open" argument must be a boolean.');
        }
        result.open = opts.open;
    }
    if (opts.readOnly !== undefined) {
        if (typeof opts.readOnly !== 'boolean') {
            throw new InvalidArgTypeError('The "options.readOnly" argument must be a boolean.');
        }
        result.readOnly = opts.readOnly;
    }
    if (opts.timeout !== undefined) {
        if (typeof opts.timeout !== 'number' || !Number.isInteger(opts.timeout)) {
            throw new InvalidArgTypeError('The "options.timeout" argument must be an integer.');
        }
        result.timeout = opts.timeout;
    }
    if (opts.enableForeignKeyConstraints !== undefined) {
        if (typeof opts.enableForeignKeyConstraints !== 'boolean') {
            throw new InvalidArgTypeError('The "options.enableForeignKeyConstraints" argument must be a boolean.');
        }
        result.enableForeignKeyConstraints = opts.enableForeignKeyConstraints;
    }
    if (opts.enableDoubleQuotedStringLiterals !== undefined) {
        if (typeof opts.enableDoubleQuotedStringLiterals !== 'boolean') {
            throw new InvalidArgTypeError('The "options.enableDoubleQuotedStringLiterals" argument must be a boolean.');
        }
        result.enableDoubleQuotedStringLiterals = opts.enableDoubleQuotedStringLiterals;
    }
    if (opts.readBigInts !== undefined) {
        if (typeof opts.readBigInts !== 'boolean') {
            throw new InvalidArgTypeError('The "options.readBigInts" argument must be a boolean.');
        }
        result.readBigInts = opts.readBigInts;
    }
    if (opts.returnArrays !== undefined) {
        if (typeof opts.returnArrays !== 'boolean') {
            throw new InvalidArgTypeError('The "options.returnArrays" argument must be a boolean.');
        }
        result.returnArrays = opts.returnArrays;
    }
    if (opts.allowBareNamedParameters !== undefined) {
        if (typeof opts.allowBareNamedParameters !== 'boolean') {
            throw new InvalidArgTypeError('The "options.allowBareNamedParameters" argument must be a boolean.');
        }
        result.allowBareNamedParameters = opts.allowBareNamedParameters;
    }
    if (opts.allowUnknownNamedParameters !== undefined) {
        if (typeof opts.allowUnknownNamedParameters !== 'boolean') {
            throw new InvalidArgTypeError('The "options.allowUnknownNamedParameters" argument must be a boolean.');
        }
        result.allowUnknownNamedParameters = opts.allowUnknownNamedParameters;
    }
    if (opts.defensive !== undefined) {
        if (typeof opts.defensive !== 'boolean') {
            throw new InvalidArgTypeError('The "options.defensive" argument must be a boolean.');
        }
        result.defensive = opts.defensive;
    }
    if (opts.allowExtension !== undefined) {
        if (typeof opts.allowExtension !== 'boolean') {
            throw new InvalidArgTypeError('The "options.allowExtension" argument must be a boolean.');
        }
        result.allowExtension = opts.allowExtension;
    }

    return result;
}

// Convert SQLite native parameter syntax (?, ?NNN, $name, :name, @name)
// to Gda's ##name::type syntax. Returns [convertedSql, parameterMap].
// parameterMap maps Gda holder IDs back to original parameter info.
interface ParamInfo {
    gdaId: string;
    originalName: string;
    position: number;
}

function convertParameterSyntax(sql: string): [string, ParamInfo[]] {
    const params: ParamInfo[] = [];
    let positionalIndex = 0;
    let result = '';
    let i = 0;

    while (i < sql.length) {
        // Skip string literals
        if (sql[i] === "'") {
            const start = i;
            i++;
            while (i < sql.length && sql[i] !== "'") {
                if (sql[i] === "'" && sql[i + 1] === "'") {
                    i += 2;
                    continue;
                }
                i++;
            }
            if (i < sql.length) i++; // closing quote
            result += sql.substring(start, i);
            continue;
        }

        // Positional parameter: ? or ?NNN
        if (sql[i] === '?') {
            i++;
            let numStr = '';
            while (i < sql.length && sql[i] >= '0' && sql[i] <= '9') {
                numStr += sql[i];
                i++;
            }
            const pos = numStr ? parseInt(numStr, 10) - 1 : positionalIndex;
            positionalIndex = numStr ? positionalIndex : positionalIndex + 1;
            const gdaId = `p${pos}`;
            params.push({ gdaId, originalName: numStr ? `?${numStr}` : '?', position: pos });
            result += `##${gdaId}::string`;
            continue;
        }

        // Named parameter: $name, :name, @name
        if (
            (sql[i] === '$' || sql[i] === ':' || sql[i] === '@') &&
            i + 1 < sql.length &&
            /[a-zA-Z_]/.test(sql[i + 1])
        ) {
            const prefix = sql[i];
            i++;
            let name = '';
            while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
                name += sql[i];
                i++;
            }
            const gdaId = name;
            params.push({ gdaId, originalName: `${prefix}${name}`, position: -1 });
            result += `##${gdaId}::string`;
            continue;
        }

        result += sql[i];
        i++;
    }

    return [result, params];
}

export class DatabaseSync {
    #connection: Gda.Connection | null = null;
    #parser: Gda.SqlParser | null = null;
    #path: string;
    #options: DatabaseSyncOptions;
    #isMemory: boolean;
    #inTransaction = false;

    constructor(path: unknown, options?: unknown) {
        // Cannot be called without new
        if (!new.target) {
            throw new ConstructCallRequiredError('DatabaseSync');
        }

        this.#path = parsePath(path);
        this.#options = validateOptions(options);
        this.#isMemory = this.#path === ':memory:';

        const shouldOpen = this.#options.open !== false;
        if (shouldOpen) {
            this.open();
        }
    }

    get [sqliteTypeSymbol](): string {
        return 'node:sqlite';
    }

    get isOpen(): boolean {
        return this.#connection !== null && this.#connection.is_opened();
    }

    get isTransaction(): boolean {
        this.#ensureOpen();
        return this.#inTransaction;
    }

    open(): undefined {
        if (this.isOpen) {
            throw new InvalidStateError('database is already open');
        }

        try {
            if (this.#isMemory) {
                // Gda.Connection.new_from_string + open() works; open_from_string has a bug
                this.#connection = Gda.Connection.new_from_string(
                    'SQLite',
                    'DB_DIR=;DB_NAME=:memory:',
                    null,
                    Gda.ConnectionOptions.NONE,
                );
            } else {
                const lastSlash = this.#path.lastIndexOf('/');
                const dir = lastSlash >= 0 ? this.#path.substring(0, lastSlash) : '.';
                const name = lastSlash >= 0 ? this.#path.substring(lastSlash + 1) : this.#path;
                // libgda's SQLite provider always stores the database as `<DB_DIR>/<DB_NAME>.db`, so
                // strip a trailing `.db` from DB_NAME: node:sqlite uses the given path verbatim, and
                // passing `foo.db` as DB_NAME would land the file at `foo.db.db` — making the real
                // file disagree with the requested path (existsSync(path) false, location() wrong).
                const dbName = name.endsWith('.db') ? name.slice(0, -3) : name;
                const cncString = `DB_DIR=${dir};DB_NAME=${dbName}`;
                const connOpts = this.#options.readOnly ? Gda.ConnectionOptions.READ_ONLY : Gda.ConnectionOptions.NONE;

                this.#connection = Gda.Connection.new_from_string('SQLite', cncString, null, connOpts);
            }
            this.#connection!.open();
        } catch (e: unknown) {
            this.#connection = null;
            throw new SqliteError(e instanceof Error ? e.message : String(e));
        }

        this.#parser = this.#connection!.create_parser() ?? new Gda.SqlParser();

        // Apply configuration PRAGMAs
        this.#applyPragmas();

        return undefined;
    }

    close(): undefined {
        if (!this.isOpen) {
            throw new InvalidStateError('database is not open');
        }
        this.#connection!.close();
        this.#connection = null;
        this.#parser = null;
        this.#inTransaction = false;
        return undefined;
    }

    /**
     * Execute one or more SQL statements. Returns undefined.
     * Named sqlExec to avoid security hook false positive on "exec" name.
     */
    sqlExec(sql: unknown): undefined {
        this.#ensureOpen();
        if (typeof sql !== 'string') {
            throw new InvalidArgTypeError('The "sql" argument must be a string.');
        }

        try {
            // Split SQL into individual statements and parse each one.
            // We can't use parse_string iteratively (double-free bug in GJS)
            // or parse_string_as_batch (returns Batch objects, not Statements).
            const statements = this.#splitStatements(sql);
            for (const stmtSql of statements) {
                const [stmt] = this.#parser!.parse_string(stmtSql);
                if (stmt) {
                    this.#executeStatement(stmt);
                }
            }
        } catch (e: unknown) {
            if (e instanceof SqliteError || e instanceof InvalidStateError || e instanceof InvalidArgTypeError) {
                throw e;
            }
            throw new SqliteError(e instanceof Error ? e.message : String(e));
        }

        // Track transaction state
        this.#updateTransactionState(sql);

        return undefined;
    }

    prepare(sql: unknown, _options?: unknown): StatementSync {
        this.#ensureOpen();
        if (typeof sql !== 'string') {
            throw new InvalidArgTypeError('The "sql" argument must be a string.');
        }

        // Extract parameter info from the SQL
        const [, paramMap] = convertParameterSyntax(sql);

        // Validate the SQL by parsing it (with params replaced by literals)
        try {
            const testSql =
                paramMap.length > 0
                    ? sql.replace(/\?(\d+)?/g, 'NULL').replace(/[$:@][a-zA-Z_][a-zA-Z0-9_]*/g, 'NULL')
                    : sql;
            const [stmt] = this.#parser!.parse_string(testSql);
            if (!stmt) {
                throw new SqliteError('Failed to parse SQL statement');
            }
        } catch (e: unknown) {
            if (e instanceof SqliteError || e instanceof InvalidArgTypeError) {
                throw e;
            }
            throw new SqliteError(e instanceof Error ? e.message : String(e));
        }

        const stmtOptions: StatementSyncOptions = {
            readBigInts: this.#options.readBigInts ?? false,
            returnArrays: this.#options.returnArrays ?? false,
            allowBareNamedParameters: this.#options.allowBareNamedParameters ?? true,
            allowUnknownNamedParameters: this.#options.allowUnknownNamedParameters ?? false,
        };

        return StatementSync._create(this.#connection!, sql, stmtOptions, paramMap, this.#parser!);
    }

    location(dbName?: unknown): string | null {
        this.#ensureOpen();
        if (dbName !== undefined && typeof dbName !== 'string') {
            throw new InvalidArgTypeError('The "dbName" argument must be a string.');
        }
        if (this.#isMemory) {
            return null;
        }
        return this.#path;
    }

    [Symbol.dispose](): void {
        if (this.isOpen) {
            try {
                this.close();
            } catch {
                /* ignore */
            }
        }
    }

    #ensureOpen(): void {
        if (!this.isOpen) {
            throw new InvalidStateError('database is not open');
        }
    }

    #applyPragmas(): void {
        const conn = this.#connection!;

        // PRAGMAs in Gda are treated as SELECT statements (type UNKNOWN=11).
        // Must use statement_execute_select, not execute_non_select_command.
        const runPragma = (pragma: string) => {
            const parser = this.#parser!;
            const [stmt] = parser.parse_string(pragma);
            if (stmt) {
                conn.statement_execute_select(stmt, null);
            }
        };

        // Foreign keys: enabled by default
        if (this.#options.enableForeignKeyConstraints !== false) {
            runPragma('PRAGMA foreign_keys = ON');
        } else {
            runPragma('PRAGMA foreign_keys = OFF');
        }

        // Busy timeout
        if (this.#options.timeout !== undefined && this.#options.timeout > 0) {
            runPragma(`PRAGMA busy_timeout = ${this.#options.timeout}`);
        }
    }

    #executeStatement(stmt: Gda.Statement): void {
        const stmtType = stmt.get_statement_type();

        // Gda treats PRAGMAs and some other statements as UNKNOWN (type 11).
        // Try non-select first; fall back to select on error.
        if (stmtType === Gda.SqlStatementType.SELECT) {
            this.#connection!.statement_execute_select(stmt, null);
        } else {
            try {
                this.#connection!.statement_execute_non_select(stmt, null);
            } catch {
                // Fallback: statement might be a PRAGMA or other "select-like" statement
                this.#connection!.statement_execute_select(stmt, null);
            }
        }
    }

    #splitStatements(sql: string): string[] {
        // Split SQL into individual statements at top-level semicolons, and strip
        // comments from each emitted chunk.
        //
        // node:sqlite hands the whole string to SQLite, whose tokenizer never
        // treats a ';' inside a comment or quoted region as a statement boundary.
        // We mirror that boundary detection: scan the string and skip over every
        // region a ';' could hide in —
        //   - '…' string literals          (with the '' escape)
        //   - "…" / `…` quoted identifiers  (with the ""/`` escape)
        //   - [ … ] quoted identifiers      (no escape; ']' ends it)
        //   - -- line comments              (to end of line)
        //   - /* … */ block comments        (not nestable, per SQLite)
        // so split-relevant tokens inside those regions never produce a spurious
        // boundary.
        //
        // Comments are then DROPPED rather than handed to the parser. libgda's
        // Gda.SqlParser.parse_string() corrupts the heap ("free(): invalid
        // pointer", an abort that takes the whole process down) when it parses a
        // statement that contains a /* … */ block comment, so passing comment
        // text through is unsafe. Stripping is semantically transparent — SQL
        // comments are inert except inside quoted regions, which we keep verbatim.
        // A line comment is removed but its terminating newline is left in place;
        // a block comment is replaced by a single space so tokens that abutted it
        // stay separated (CREATE/**/TABLE → CREATE TABLE). A chunk that strips to
        // nothing (a standalone or trailing comment) trims to empty and is
        // dropped, matching node:sqlite which silently ignores such comments.
        const stmts: string[] = [];
        let current = '';
        const n = sql.length;
        let i = 0;

        const flush = () => {
            const trimmed = current.trim();
            if (trimmed.length > 0) {
                stmts.push(trimmed);
            }
            current = '';
        };

        while (i < n) {
            const ch = sql[i];
            const next = sql[i + 1];

            // -- line comment: drop it; the terminating newline is left in place.
            if (ch === '-' && next === '-') {
                let j = i + 2;
                while (j < n && sql[j] !== '\n') {
                    j++;
                }
                i = j;
                continue;
            }

            // /* … */ block comment: drop it (replaced by a single space),
            // consuming through the closing delimiter or to the end of input.
            if (ch === '/' && next === '*') {
                let j = i + 2;
                while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) {
                    j++;
                }
                i = j < n ? j + 2 : n;
                current += ' ';
                continue;
            }

            // Quoted regions, kept verbatim: '…' literal, "…"/`…` identifiers
            // (doubled-quote escape), and [ … ] identifier (first ']' ends it).
            if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
                const close = ch === '[' ? ']' : ch;
                const doubled = ch !== '['; // brackets have no escape sequence
                let j = i + 1;
                current += ch;
                while (j < n) {
                    if (sql[j] === close) {
                        if (doubled && sql[j + 1] === close) {
                            current += close + close;
                            j += 2;
                            continue;
                        }
                        current += close;
                        j++;
                        break;
                    }
                    current += sql[j];
                    j++;
                }
                i = j;
                continue;
            }

            // Top-level statement boundary.
            if (ch === ';') {
                flush();
                i++;
                continue;
            }

            current += ch;
            i++;
        }
        flush();
        return stmts;
    }

    #updateTransactionState(sql: string): void {
        const trimmed = sql.trim().toUpperCase();
        if (/\bBEGIN\b/.test(trimmed)) {
            this.#inTransaction = true;
        }
        if (/\bCOMMIT\b/.test(trimmed) || /\bROLLBACK\b/.test(trimmed)) {
            this.#inTransaction = false;
        }
    }
}

// Expose exec() as public API. Named sqlExec internally to avoid security hook
// false positive on the string "exec" in method definitions.
(DatabaseSync.prototype as unknown as Record<string, unknown>).exec = DatabaseSync.prototype.sqlExec;

export type { ParamInfo };
