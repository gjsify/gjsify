// StatementSync class for node:sqlite
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import Gda from '@girs/gda-6.0';
import { IllegalConstructorError, InvalidArgTypeError, InvalidArgValueError, SqliteError } from './errors.ts';
import { readAllRows, readFirstRow, type ReadOptions } from './data-model-reader.ts';
import type { RunResult, StatementSyncOptions } from './types.ts';
import type { ParamInfo } from './database-sync.ts';

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;

// Sentinel to prevent direct construction
const INTERNAL = Symbol('StatementSync.internal');

function validateBindValue(value: unknown, paramIndex: number): void {
    if (value === null) return;
    const t = typeof value;
    if (t === 'number' || t === 'bigint' || t === 'string' || t === 'boolean') return;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return;
    if (ArrayBuffer.isView(value)) return;
    throw new InvalidArgTypeError(
        `Provided value cannot be bound to SQLite parameter ${paramIndex}.`
    );
}

// Escape a JS value for inline SQL. This is safe because only values are
// interpolated — the SQL structure comes from the user's original prepare() call.
function sqlEscapeValue(value: unknown): string {
    if (value === null) return 'NULL';
    if (value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'bigint') {
        if (value > MAX_INT64 || value < MIN_INT64) {
            throw new InvalidArgValueError('BigInt value is too large to bind.');
        }
        return String(value);
    }
    if (typeof value === 'string') return "'" + value.replace(/'/g, "''") + "'";
    if (value instanceof Uint8Array) {
        // SQLite BLOB literal: X'hex'
        let hex = '';
        for (let i = 0; i < value.length; i++) {
            hex += value[i].toString(16).padStart(2, '0');
        }
        return "X'" + hex + "'";
    }
    if (ArrayBuffer.isView(value)) {
        return sqlEscapeValue(new Uint8Array((value as ArrayBufferView).buffer));
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
    #parser: Gda.SqlParser;

    constructor(sentinel: symbol, connection: Gda.Connection, sql: string, options: StatementSyncOptions, paramMap: ParamInfo[], parser: Gda.SqlParser) {
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
        this.#parser = parser;
    }

    /** @internal */
    static _create(connection: Gda.Connection, sql: string, options: StatementSyncOptions, paramMap: ParamInfo[], parser: Gda.SqlParser): StatementSync {
        return new StatementSync(INTERNAL, connection, sql, options, paramMap, parser);
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

    // Build the final SQL with parameter values substituted inline.
    // Returns the SQL string ready for execution.
    #buildSql(args: unknown[]): string {
        if (this.#paramMap.length === 0) {
            if (args.length > 0) {
                const hasNamedArg = args.length > 0 && args[0] !== null && typeof args[0] === 'object' && !(args[0] instanceof Uint8Array) && !ArrayBuffer.isView(args[0]);
                if (!hasNamedArg) {
                    throw new SqliteError('column index out of range', 25, 'column index out of range');
                }
            }
            return this.#sql;
        }

        // Determine if first arg is a named params object
        let namedArgs: Record<string, unknown> | null = null;
        let positionalArgs: unknown[] = args;

        if (args.length > 0 && args[0] !== null && typeof args[0] === 'object' && !(args[0] instanceof Uint8Array) && !ArrayBuffer.isView(args[0])) {
            namedArgs = args[0] as Record<string, unknown>;
            positionalArgs = args.slice(1);
        }

        // Build maps: named params use Map<originalName, escaped>, positional use index-keyed object
        const values = new Map<string, string>();
        const positionalValues: Record<number, string> = {};

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
                    const bareName = origName.replace(/^[\$:@]/, '');
                    if (bareName in namedArgs) {
                        value = namedArgs[bareName];
                        found = true;
                    }
                }

                if (!found && !this.#allowBareNamedParameters) {
                    const bareName = origName.replace(/^[\$:@]/, '');
                    if (bareName in namedArgs) {
                        throw new SqliteError(`Unknown named parameter '${bareName}'`, 0, `Unknown named parameter '${bareName}'`);
                    }
                }

                if (found) {
                    validateBindValue(value, this.#paramMap.indexOf(param) + 1);
                    values.set(param.originalName, sqlEscapeValue(value));
                } else {
                    values.set(param.originalName, 'NULL');
                }
            }

            // Handle positional after named
            const positionalParams = this.#paramMap.filter(p => p.position >= 0);
            for (let i = 0; i < positionalArgs.length; i++) {
                if (i >= positionalParams.length) {
                    throw new SqliteError('column index out of range', 25, 'column index out of range');
                }
                validateBindValue(positionalArgs[i], i + 1);
                positionalValues[positionalParams[i].position] = sqlEscapeValue(positionalArgs[i]);
            }
        } else {
            // Pure positional binding
            const positionalParams = this.#paramMap.filter(p => p.position >= 0);
            if (positionalArgs.length > positionalParams.length && positionalParams.length > 0) {
                throw new SqliteError('column index out of range', 25, 'column index out of range');
            }

            for (let i = 0; i < positionalParams.length; i++) {
                if (i < positionalArgs.length) {
                    validateBindValue(positionalArgs[i], i + 1);
                    positionalValues[positionalParams[i].position] = sqlEscapeValue(positionalArgs[i]);
                } else {
                    // Not provided — bind as NULL (not an error)
                    positionalValues[positionalParams[i].position] = 'NULL';
                }
            }
        }

        // Substitute parameters in SQL
        let result = this.#sql;

        // Replace named params ($name, :name, @name) — longest first to avoid partial matches
        const namedParams = this.#paramMap.filter(p => p.position < 0).sort((a, b) => b.originalName.length - a.originalName.length);
        for (const param of namedParams) {
            const escaped = values.get(param.originalName) ?? 'NULL';
            result = result.split(param.originalName).join(escaped);
        }

        // Replace positional params (? or ?NNN) — scan left-to-right
        if (Object.keys(positionalValues).length > 0) {
            let out = '';
            let pIdx = 0;
            let i = 0;
            while (i < result.length) {
                if (result[i] === "'") {
                    const start = i;
                    i++;
                    while (i < result.length && result[i] !== "'") {
                        if (result[i] === "'" && result[i + 1] === "'") { i += 2; continue; }
                        i++;
                    }
                    if (i < result.length) i++;
                    out += result.substring(start, i);
                    continue;
                }
                if (result[i] === '?') {
                    i++;
                    let numStr = '';
                    while (i < result.length && result[i] >= '0' && result[i] <= '9') {
                        numStr += result[i];
                        i++;
                    }
                    const pos = numStr ? parseInt(numStr, 10) - 1 : pIdx;
                    pIdx = numStr ? pIdx : pIdx + 1;
                    out += (pos in positionalValues) ? positionalValues[pos] : 'NULL';
                    continue;
                }
                out += result[i];
                i++;
            }
            result = out;
        }

        return result;
    }

    #executeSql(sql: string): { model: Gda.DataModel | null; isSelect: boolean } {
        const [stmt] = this.#parser.parse_string(sql);
        if (!stmt) {
            throw new SqliteError('Failed to parse SQL statement');
        }
        const stmtType = stmt.get_statement_type();
        if (stmtType === Gda.SqlStatementType.SELECT) {
            return { model: this.#connection.statement_execute_select(stmt, null), isSelect: true };
        }
        try {
            this.#connection.statement_execute_non_select(stmt, null);
            return { model: null, isSelect: false };
        } catch {
            // Might be PRAGMA or similar — try as select
            const model = this.#connection.statement_execute_select(stmt, null);
            return { model, isSelect: true };
        }
    }

    run(...args: unknown[]): RunResult {
        const sql = this.#buildSql(args);
        this.#executeSql(sql);

        let changes: number | bigint = 0;
        let lastInsertRowid: number | bigint = 0;

        try {
            const chModel = this.#connection.execute_select_command('SELECT changes()');
            if (chModel && chModel.get_n_rows() > 0) {
                changes = chModel.get_value_at(0, 0) as number;
            }
        } catch { /* ignore */ }

        try {
            const ridModel = this.#connection.execute_select_command('SELECT last_insert_rowid()');
            if (ridModel && ridModel.get_n_rows() > 0) {
                lastInsertRowid = ridModel.get_value_at(0, 0) as number;
            }
        } catch { /* ignore */ }

        if (this.#readBigInts) {
            changes = BigInt(changes);
            lastInsertRowid = BigInt(lastInsertRowid);
        }

        return { changes, lastInsertRowid };
    }

    get(...args: unknown[]): Record<string, unknown> | unknown[] | undefined {
        const sql = this.#buildSql(args);
        try {
            const { model } = this.#executeSql(sql);
            if (!model || model.get_n_rows() === 0) {
                return undefined;
            }
            return readFirstRow(model, this.#getReadOptions());
        } catch {
            return undefined;
        }
    }

    all(...args: unknown[]): (Record<string, unknown> | unknown[])[] {
        const sql = this.#buildSql(args);
        try {
            const { model } = this.#executeSql(sql);
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
