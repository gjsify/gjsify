// StatementSync class for node:sqlite
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import type Gda from '@girs/gda-6.0';
import {
    IllegalConstructorError,
    InvalidArgTypeError,
    InvalidArgValueError,
    isNodeSqliteError,
    SqliteError,
    sqliteErrorMessage,
} from './errors.ts';
import { readAllRows, readFirstRow, type ReadOptions } from './data-model-reader.ts';
import { rewriteExistsSubqueries } from './exists-subquery.ts';
import { ColumnTypes, executeStatement, integerColumns, releaseStatement } from './execution.ts';
import { bindHolders, type HolderBinding, releaseHolders } from './param-binding.ts';
import { convertParameterSyntax, type ParamInfo } from './parameter-syntax.ts';
import { parseSql } from './parse-sql.ts';
import { providerSql, statementKind, type StatementKind } from './statement-kind.ts';
import type { RunResult, StatementSyncOptions } from './types.ts';

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;

// Sentinel to prevent direct construction
const INTERNAL = Symbol('StatementSync.internal');

/**
 * How many rendered SQL texts of ONE prepared statement keep their parsed statement.
 *
 * Every execution whose parameters are all bound renders the same text, so a statement
 * used the ordinary way needs one entry. More are only reached through the values that
 * stay literals (see `sqlLiteral`), and a BLOB puts its whole hex into the text — so an
 * unbounded map would grow with the DATA. Past this the least recently used statement is
 * dropped, which costs its next execution one parse.
 */
const MAX_CACHED_STATEMENTS = 8;

const COUNTER_SQL = 'SELECT changes(), last_insert_rowid()';

/**
 * Both counters are read as text: a rowid is a 64-bit integer, and libgda would type the
 * column gint and refuse any rowid past 2^31 - 1. The shape is fixed, so one description
 * answers for every connection and nothing ever has to probe it.
 */
const COUNTER_COLUMNS = integerColumns(2);

/**
 * `SELECT changes(), last_insert_rowid()` parsed once per connection.
 *
 * `run()` asks after every execution, so parsing it per call put a second parse — and a
 * second compile — on the hot path of every INSERT. Shared across the statements of one
 * connection rather than held per `StatementSync`: they would all be the same query, and
 * each copy would occupy one of the connection's bounded retained entries.
 */
const counterStatements = new WeakMap<Gda.Connection, Gda.Statement>();

function counterStatement(connection: Gda.Connection): Gda.Statement {
    const cached = counterStatements.get(connection);
    if (cached) return cached;
    const [stmt] = parseSql(connection, COUNTER_SQL);
    counterStatements.set(connection, stmt);
    return stmt;
}

/** node:sqlite reads a leading plain object as the named-parameter bag. */
function isNamedArgObject(arg: unknown): boolean {
    return arg !== null && typeof arg === 'object' && !(arg instanceof Uint8Array) && !ArrayBuffer.isView(arg);
}

/**
 * Refuse a value SQLite has no storage class for, before it reaches the SQL.
 *
 * `undefined` passes, and binds NULL. node:sqlite refused it until v26.10.0, where
 * nodejs/node#65709 made it bind NULL so that an explicitly-passed `undefined` agrees with
 * an omitted parameter — which bound NULL all along, there and in `#buildStatement` below.
 * That release also dropped `undefined` from the "unsupported data types" list this package's
 * spec is ported from, and wrote the rule into `doc/api/sqlite.md`: NULL is written from
 * `null` or `undefined`, and always reads back as `null`.
 */
function validateBindValue(value: unknown, paramIndex: number): void {
    if (value === null || value === undefined) return;
    const t = typeof value;
    if (t === 'number' || t === 'bigint' || t === 'string' || t === 'boolean') return;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return;
    if (ArrayBuffer.isView(value)) return;
    throw new InvalidArgTypeError(`Provided value cannot be bound to SQLite parameter ${paramIndex}.`);
}

/**
 * How a value reaches SQLite, or null for one that has to stay in the SQL text.
 *
 * Everything bindable goes through a holder, because that is what keeps the SQL TEXT
 * identical across executions — and the text is what the parsed statement, and the
 * compiled `sqlite3_stmt` behind it, are cached under (`#statementFor`). Before this,
 * every non-string value was written into the SQL, so `run(1)` and `run(2)` were two
 * different statements and neither could reuse anything.
 *
 * The storage classes are the ones the literals produced, verified by reading the stored
 * value back as text: see `HolderType` in param-binding.ts.
 */
function holderBinding(value: unknown): HolderBinding | null {
    if (typeof value === 'string') return { type: 'gchararray', value };
    if (typeof value === 'number') return { type: 'gdouble', value };
    if (typeof value === 'bigint') {
        if (value > MAX_INT64 || value < MIN_INT64) {
            throw new InvalidArgValueError('BigInt value is too large to bind.');
        }
        return { type: 'gint64', value };
    }
    // A superset of node:sqlite, which REJECTS booleans outright ("Provided value cannot
    // be bound to SQLite parameter N"). Kept because consumers rely on it; that is also
    // why no test asserts it — the Node half of the suite would throw.
    if (typeof value === 'boolean') return { type: 'gint64', value: value ? 1 : 0 };
    return null;
}

/**
 * Render the values a holder cannot carry — NULL and a BLOB — as a SQL literal.
 *
 * libgda refuses NULL through a holder by every spelling, and a `Uint8Array` is "Could
 * not guess unspecified GValue type" (see param-binding.ts). Both emit characters from a
 * closed alphabet — the bare word `NULL`, or `X'…'` over hex — so neither can end a
 * quoted region or begin a second statement, whatever the caller passed.
 *
 * Do not add a string branch back. libgda's parser treats `\` as an escape inside `'…'`
 * and SQLite does not, so a value ending in a backslash — or carrying `\'` — made the
 * quoted region run past its intended end. The statement then finished early, libgda set
 * its `remain` out-parameter, and GJS aborted the process freeing it (see parse-sql.ts).
 */
function sqlLiteral(value: unknown): string {
    if (value instanceof Uint8Array) {
        // SQLite BLOB literal: X'hex'
        let hex = '';
        for (let i = 0; i < value.length; i++) {
            hex += value[i].toString(16).padStart(2, '0');
        }
        return "X'" + hex + "'";
    }
    if (ArrayBuffer.isView(value)) {
        return sqlLiteral(new Uint8Array((value as ArrayBufferView).buffer));
    }
    return 'NULL';
}

export class StatementSync {
    #connection: Gda.Connection;
    #sql: string;
    #paramMap: ParamInfo[];
    #readBigInts: boolean;
    #returnArrays: boolean;
    #allowBareNamedParameters: boolean;
    #allowUnknownNamedParameters: boolean;
    /** How this statement's result columns are read; learned on the first get()/all(). */
    #columns = new ColumnTypes();
    /**
     * What the statement does, decided once from its SQL.
     *
     * A statement with a CTE reaches libgda as UNKNOWN whatever it does, so the
     * row-vs-rows decision needs this answer (see `statement-kind.ts`). It cannot change
     * between executions: the parameters move, the statement does not. The rendered text
     * of an execution differs from the SQL it was decided from in the parameter
     * placeholders alone — `?` becomes `##id::type` — and a placeholder is no keyword,
     * so the verb is the same in both.
     */
    #kind: StatementKind;
    /**
     * Rendered SQL → what libgda parsed it into, youngest last.
     *
     * Keeping this is the point of the class: `parse_sql_string()` builds a statement
     * tree per call, and the connection then compiles a `sqlite3_stmt` for every tree it
     * has not seen — so a `StatementSync` executed in a loop paid for both on every
     * execution. The holder set belongs to the parse and is rebound per execution.
     */
    #parsed = new Map<string, [Gda.Statement, Gda.Set | null]>();

    constructor(
        sentinel: symbol,
        connection: Gda.Connection,
        sql: string,
        options: StatementSyncOptions,
        paramMap: ParamInfo[],
    ) {
        if (sentinel !== INTERNAL) {
            throw new IllegalConstructorError();
        }
        this.#connection = connection;
        this.#sql = sql;
        this.#paramMap = paramMap;
        this.#kind = statementKind(sql);
        this.#readBigInts = options.readBigInts ?? false;
        this.#returnArrays = options.returnArrays ?? false;
        this.#allowBareNamedParameters = options.allowBareNamedParameters ?? true;
        this.#allowUnknownNamedParameters = options.allowUnknownNamedParameters ?? false;
    }

    /** @internal */
    static _create(
        connection: Gda.Connection,
        sql: string,
        options: StatementSyncOptions,
        paramMap: ParamInfo[],
    ): StatementSync {
        return new StatementSync(INTERNAL, connection, sql, options, paramMap);
    }

    get sourceSQL(): string {
        return this.#sql;
    }

    get expandedSQL(): string {
        return this.#sql;
    }

    #getReadOptions(textColumns: boolean[]): ReadOptions {
        return {
            readBigInts: this.#readBigInts,
            returnArrays: this.#returnArrays,
            textColumns,
        };
    }

    /**
     * Highest positional index used, or -1 for none.
     *
     * This — not the number of `?` occurrences — is how many positional arguments the
     * statement takes. `?1` written twice is one parameter, and `?5` alone is five.
     */
    #highestPosition(): number {
        let highest = -1;
        for (const param of this.#paramMap) {
            if (param.position > highest) highest = param.position;
        }
        return highest;
    }

    /**
     * Resolve `args` against this statement's parameters and render the SQL for ONE
     * execution.
     *
     * Every value libgda can carry through a holder becomes a `##id::<type>` placeholder
     * and is returned for binding, so the rendered TEXT depends only on WHICH parameters
     * are NULL or a BLOB — not on the values — and `#statementFor` can hand the same
     * parsed statement back for the next execution. NULL and a BLOB are the two that
     * cannot be bound and stay literals from a closed alphabet (see `sqlLiteral`).
     *
     * The rendering happens per execution rather than once at prepare() because the
     * choice depends on the value: the same prepared statement can be run with a string
     * one time and a NULL the next.
     */
    #buildStatement(args: unknown[]): { sql: string; bindings: Map<string, HolderBinding> } {
        const bindings = new Map<string, HolderBinding>();

        if (this.#paramMap.length === 0) {
            if (args.length > 0 && !isNamedArgObject(args[0])) {
                throw new SqliteError('column index out of range', 25, 'column index out of range');
            }
            return { sql: this.#sql, bindings };
        }

        // Determine if first arg is a named params object
        let namedArgs: Record<string, unknown> | null = null;
        let positionalArgs: unknown[] = args;

        if (args.length > 0 && isNamedArgObject(args[0])) {
            namedArgs = args[0] as Record<string, unknown>;
            positionalArgs = args.slice(1);
        }

        // gdaId → the value this execution supplies. A parameter left out stays absent and
        // renders as NULL, which is what node:sqlite binds for a missing parameter.
        const values = new Map<string, unknown>();

        if (namedArgs) {
            for (const param of this.#paramMap) {
                if (param.position >= 0) continue; // Handle positional separately
                const origName = param.originalName;
                let value: unknown = undefined;
                let found = false;

                // Exact match with prefix ($name, :name, @name)
                if (origName in namedArgs) {
                    value = namedArgs[origName];
                    found = true;
                }

                // Bare name
                if (!found && this.#allowBareNamedParameters) {
                    const bareName = origName.replace(/^[$:@]/, '');
                    if (bareName in namedArgs) {
                        value = namedArgs[bareName];
                        found = true;
                    }
                }

                if (!found && !this.#allowBareNamedParameters) {
                    const bareName = origName.replace(/^[$:@]/, '');
                    if (bareName in namedArgs) {
                        throw new SqliteError(
                            `Unknown named parameter '${bareName}'`,
                            0,
                            `Unknown named parameter '${bareName}'`,
                        );
                    }
                }

                if (found) {
                    validateBindValue(value, this.#paramMap.indexOf(param) + 1);
                    values.set(param.gdaId, value);
                }
            }

            // Reject keys in `namedArgs` that don't map to any known SQL parameter,
            // unless explicitly allowed (matches Node's allowUnknownNamedParameters).
            if (!this.#allowUnknownNamedParameters) {
                const knownNames = new Set<string>();
                for (const param of this.#paramMap) {
                    if (param.position >= 0) continue;
                    knownNames.add(param.originalName);
                    knownNames.add(param.originalName.replace(/^[$:@]/, ''));
                }
                for (const key of Object.keys(namedArgs)) {
                    if (!knownNames.has(key) && !knownNames.has(key.replace(/^[$:@]/, ''))) {
                        throw new SqliteError(
                            `Unknown named parameter '${key}'`,
                            0,
                            `Unknown named parameter '${key}'`,
                        );
                    }
                }
            }

            // Handle positional after named
            for (let i = 0; i < positionalArgs.length; i++) {
                if (i > this.#highestPosition()) {
                    throw new SqliteError('column index out of range', 25, 'column index out of range');
                }
                validateBindValue(positionalArgs[i], i + 1);
                values.set(`p${i}`, positionalArgs[i]);
            }
        } else {
            // Pure positional binding. The Nth argument goes to the parameter at INDEX N —
            // `?3` takes the third argument, wherever it stands in the SQL — so bind by
            // index rather than by order of appearance. A parameter with no argument is
            // left absent and renders as NULL, which is not an error.
            const count = this.#highestPosition() + 1;
            if (positionalArgs.length > count && count > 0) {
                throw new SqliteError('column index out of range', 25, 'column index out of range');
            }

            for (let i = 0; i < Math.min(positionalArgs.length, count); i++) {
                validateBindValue(positionalArgs[i], i + 1);
                values.set(`p${i}`, positionalArgs[i]);
            }
        }

        const [sql] = convertParameterSyntax(this.#sql, (param) => {
            const value = values.get(param.gdaId);
            const binding = holderBinding(value);
            if (!binding) return sqlLiteral(value);
            bindings.set(param.gdaId, binding);
            return `##${param.gdaId}::${binding.type}`;
        });

        return { sql, bindings };
    }

    /**
     * The parsed statement for one rendered SQL text, parsing it only the first time.
     *
     * The statement IDENTITY is what matters, not just the saved parse: the connection
     * caches its compiled `sqlite3_stmt` per `Gda.Statement`, and `executeStatement` is
     * asked to keep that entry — so handing the same object back is what lets SQLite skip
     * the compile. A dropped entry gives its cache entry back here, where it is still
     * known which connection holds it.
     *
     * The text handed to libgda is not necessarily the caller's: a statement with a CTE
     * is stated as `SELECT * FROM ( … )`, because the provider dispatches on the first
     * word of the text and would otherwise run it as a command (see `statement-kind.ts`).
     */
    #statementFor(sql: string): [Gda.Statement, Gda.Set | null] {
        const cached = this.#parsed.get(sql);
        if (cached) {
            // Delete-then-set moves the entry to the end; Map iterates insertion order.
            this.#parsed.delete(sql);
            this.#parsed.set(sql, cached);
            return cached;
        }
        const parsed = parseSql(this.#connection, providerSql(rewriteExistsSubqueries(sql), this.#kind));
        this.#parsed.set(sql, parsed);
        while (this.#parsed.size > MAX_CACHED_STATEMENTS) {
            const [oldestSql, [oldestStmt]] = this.#parsed.entries().next().value!;
            this.#parsed.delete(oldestSql);
            releaseStatement(this.#connection, oldestStmt);
        }
        return parsed;
    }

    /**
     * Execute the statement, read its result, and let every failure out.
     *
     * This is the ONE seam where libgda can refuse the statement — `prepare()` hands the
     * SQL to libgda's parser, which checks SYNTAX and never looks at the database, so a
     * query naming a table or column that does not exist is legitimately prepared and can
     * fail no earlier than here. Whatever it says has to reach the caller: an error
     * turned into "no rows" is a wrong answer no consumer can tell from an empty table.
     *
     * `read` sees the data model — or null for a statement that yields no rows — while it
     * is still alive; `executeStatement()` releases it afterwards (see execution.ts). Pass
     * `columns` only when `read` reads rows: it is what makes 64-bit integers exact.
     */
    #execute<T>(
        args: unknown[],
        read: (model: Gda.DataModel | null, textColumns: boolean[]) => T,
        columns?: ColumnTypes,
    ): T {
        const { sql, bindings } = this.#buildStatement(args);
        let params: Gda.Set | null = null;
        try {
            let stmt: Gda.Statement;
            [stmt, params] = this.#statementFor(sql);
            bindHolders(params, bindings);
            return executeStatement(this.#connection, stmt, params, read, {
                columns,
                retain: true,
                kind: this.#kind,
            });
        } catch (e: unknown) {
            // libgda reports through GLib.Error, whose `code` is a numeric GError enum,
            // while a consumer written against node:sqlite branches on
            // `err.code === 'ERR_SQLITE_ERROR'` — so it has to be translated. Our own
            // validation errors already carry that shape and pass through unchanged.
            if (isNodeSqliteError(e)) throw e;
            throw new SqliteError(sqliteErrorMessage(e));
        } finally {
            releaseHolders(params, bindings);
        }
    }

    run(...args: unknown[]): RunResult {
        this.#execute(args, () => undefined);

        // One query for both counters, parsed once per connection and kept compiled like
        // this statement itself. SQLite's own functions answer for the connection as
        // node:sqlite's sqlite3_changes64() and sqlite3_last_insert_rowid() do — including
        // their values surviving a statement that changes nothing.
        const [changes, lastInsertRowid] = executeStatement(
            this.#connection,
            counterStatement(this.#connection),
            null,
            (model) => {
                if (!model || model.get_n_rows() === 0) {
                    throw new SqliteError(`${COUNTER_SQL} returned no row`);
                }
                return [
                    BigInt(model.get_value_at(0, 0) as unknown as string),
                    BigInt(model.get_value_at(1, 0) as unknown as string),
                ];
            },
            { columns: COUNTER_COLUMNS, retain: true },
        );

        // node:sqlite: BigInt with readBigInts, otherwise a Number even where that rounds —
        // unlike a column value, which throws past Number.MAX_SAFE_INTEGER instead.
        if (this.#readBigInts) {
            return { changes, lastInsertRowid };
        }
        return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
    }

    get(...args: unknown[]): Record<string, unknown> | unknown[] | undefined {
        return this.#execute(
            args,
            (model, textColumns) => {
                if (!model || model.get_n_rows() === 0) {
                    return undefined;
                }
                return readFirstRow(model, this.#getReadOptions(textColumns));
            },
            this.#columns,
        );
    }

    all(...args: unknown[]): (Record<string, unknown> | unknown[])[] {
        return this.#execute(
            args,
            (model, textColumns) => (model ? readAllRows(model, this.#getReadOptions(textColumns)) : []),
            this.#columns,
        );
    }

    setReadBigInts(enabled: unknown): undefined {
        if (typeof enabled !== 'boolean') {
            throw new InvalidArgTypeError('The "readBigInts" argument must be a boolean.');
        }
        this.#readBigInts = enabled;
        return undefined;
    }

    setReturnArrays(enabled: unknown): undefined {
        if (typeof enabled !== 'boolean') {
            throw new InvalidArgTypeError('The "returnArrays" argument must be a boolean.');
        }
        this.#returnArrays = enabled;
        return undefined;
    }

    setAllowBareNamedParameters(enabled: unknown): undefined {
        if (typeof enabled !== 'boolean') {
            throw new InvalidArgTypeError('The "allowBareNamedParameters" argument must be a boolean.');
        }
        this.#allowBareNamedParameters = enabled;
        return undefined;
    }

    setAllowUnknownNamedParameters(enabled: unknown): undefined {
        if (typeof enabled !== 'boolean') {
            throw new InvalidArgTypeError('The "allowUnknownNamedParameters" argument must be a boolean.');
        }
        this.#allowUnknownNamedParameters = enabled;
        return undefined;
    }
}
