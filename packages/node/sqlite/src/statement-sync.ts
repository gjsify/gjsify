// StatementSync class for node:sqlite
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import Gda from '@girs/gda-6.0';
import { IllegalConstructorError, InvalidArgTypeError, InvalidArgValueError, SqliteError } from './errors.ts';
import { readAllRows, readFirstRow, type ReadOptions } from './data-model-reader.ts';
import { bindStringHolders } from './param-binding.ts';
import { convertParameterSyntax, type ParamInfo } from './parameter-syntax.ts';
import { parseSql } from './parse-sql.ts';
import type { RunResult, StatementSyncOptions } from './types.ts';

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;

// Sentinel to prevent direct construction
const INTERNAL = Symbol('StatementSync.internal');

/** node:sqlite reads a leading plain object as the named-parameter bag. */
function isNamedArgObject(arg: unknown): boolean {
    return arg !== null && typeof arg === 'object' && !(arg instanceof Uint8Array) && !ArrayBuffer.isView(arg);
}

function validateBindValue(value: unknown, paramIndex: number): void {
    if (value === null) return;
    const t = typeof value;
    if (t === 'number' || t === 'bigint' || t === 'string' || t === 'boolean') return;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return;
    if (ArrayBuffer.isView(value)) return;
    throw new InvalidArgTypeError(`Provided value cannot be bound to SQLite parameter ${paramIndex}.`);
}

/**
 * Render a NON-STRING value as a SQL literal.
 *
 * Every branch emits characters from a closed alphabet — digits, `-`, `.`, `e`, hex, or
 * the bare words `NULL` / `X'…'` — so the result cannot end a quoted region or begin a
 * second statement, whatever the caller passed. Strings are the one type that can, and
 * they never reach here: `#buildStatement` binds them to a Gda holder instead.
 *
 * Do not add a string branch back. libgda's parser treats `\` as an escape inside `'…'`
 * and SQLite does not, so a value ending in a backslash — or carrying `\'` — made the
 * quoted region run past its intended end. The statement then finished early, libgda set
 * its `remain` out-parameter, and GJS aborted the process freeing it (see parse-sql.ts).
 */
function sqlLiteral(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') {
        // SQLite stores NaN as NULL and has no infinity literal; 9e999 overflows to one,
        // which is what sqlite3_bind_double leaves behind. Matches node:sqlite.
        if (Number.isNaN(value)) return 'NULL';
        if (value === Infinity) return '9e999';
        if (value === -Infinity) return '-9e999';
        const text = String(value);
        // A JS number is a double, and node:sqlite binds it with sqlite3_bind_double — so
        // `42` lands in a typeless column as REAL, not INTEGER. Give an integral value a
        // decimal point so the storage class agrees; affinity still converts it back where
        // the column asks for an integer. Not for exponent form, where a trailing `.0`
        // would be invalid SQL — and where SQLite reads REAL anyway.
        if (Number.isInteger(value) && !text.includes('e') && !text.includes('E')) {
            return `${text}.0`;
        }
        return text;
    }
    // A superset of node:sqlite, which REJECTS booleans outright ("Provided value cannot
    // be bound to SQLite parameter N"). Kept because consumers rely on it; that is also
    // why no test asserts it — the Node half of the suite would throw.
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'bigint') {
        if (value > MAX_INT64 || value < MIN_INT64) {
            throw new InvalidArgValueError('BigInt value is too large to bind.');
        }
        return String(value);
    }
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

    #getReadOptions(): ReadOptions {
        return {
            readBigInts: this.#readBigInts,
            returnArrays: this.#returnArrays,
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
     * A string value becomes a `##id::string` placeholder and is returned for binding, so
     * its text never enters the SQL. Every other type becomes a literal from a closed
     * alphabet (see `sqlLiteral`). The rendering happens per execution rather than once at
     * prepare() because the choice depends on the value: the same prepared statement can
     * be run with a string one time and a number the next.
     */
    #buildStatement(args: unknown[]): { sql: string; strings: Map<string, string> } {
        const strings = new Map<string, string>();

        if (this.#paramMap.length === 0) {
            if (args.length > 0 && !isNamedArgObject(args[0])) {
                throw new SqliteError('column index out of range', 25, 'column index out of range');
            }
            return { sql: this.#sql, strings };
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
            if (typeof value === 'string') {
                strings.set(param.gdaId, value);
                return `##${param.gdaId}::string`;
            }
            return sqlLiteral(value);
        });

        return { sql, strings };
    }

    #executeSql(args: unknown[]): { model: Gda.DataModel | null; isSelect: boolean } {
        const { sql, strings } = this.#buildStatement(args);
        const [stmt, params] = parseSql(this.#connection, sql);
        bindStringHolders(params, strings);

        const stmtType = stmt.get_statement_type();
        if (stmtType === Gda.SqlStatementType.SELECT) {
            return { model: this.#connection.statement_execute_select(stmt, params), isSelect: true };
        }
        try {
            this.#connection.statement_execute_non_select(stmt, params);
            return { model: null, isSelect: false };
        } catch {
            // Might be PRAGMA or similar — try as select
            const model = this.#connection.statement_execute_select(stmt, params);
            return { model, isSelect: true };
        }
    }

    run(...args: unknown[]): RunResult {
        this.#executeSql(args);

        let changes: number | bigint = 0;
        let lastInsertRowid: number | bigint = 0;

        try {
            const chModel = this.#connection.execute_select_command('SELECT changes()');
            if (chModel && chModel.get_n_rows() > 0) {
                changes = chModel.get_value_at(0, 0) as unknown as number;
            }
        } catch {
            /* ignore */
        }

        try {
            const ridModel = this.#connection.execute_select_command('SELECT last_insert_rowid()');
            if (ridModel && ridModel.get_n_rows() > 0) {
                lastInsertRowid = ridModel.get_value_at(0, 0) as unknown as number;
            }
        } catch {
            /* ignore */
        }

        if (this.#readBigInts) {
            changes = BigInt(changes);
            lastInsertRowid = BigInt(lastInsertRowid);
        }

        return { changes, lastInsertRowid };
    }

    get(...args: unknown[]): Record<string, unknown> | unknown[] | undefined {
        try {
            const { model } = this.#executeSql(args);
            if (!model || model.get_n_rows() === 0) {
                return undefined;
            }
            return readFirstRow(model, this.#getReadOptions());
        } catch {
            return undefined;
        }
    }

    all(...args: unknown[]): (Record<string, unknown> | unknown[])[] {
        try {
            const { model } = this.#executeSql(args);
            if (!model) {
                return [];
            }
            return readAllRows(model, this.#getReadOptions());
        } catch {
            return [];
        }
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
