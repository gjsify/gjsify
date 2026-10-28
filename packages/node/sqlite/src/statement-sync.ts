// StatementSync class for node:sqlite
// Reference: Node.js lib/sqlite.js + src/node_sqlite.cc
// Implemented for GJS over @gjsify/sqlite-native, which is libsqlite3 itself.

import type {
    Database as NativeDatabase,
    NativeSqliteModule,
    Statement as NativeStatement,
} from '@gjsify/sqlite-native';
import {
    IllegalConstructorError,
    InvalidArgTypeError,
    InvalidArgValueError,
    InvalidStateError,
    OutOfRangeError,
    SqliteError,
    toSqliteError,
} from './errors.ts';
import { nativeSqlite } from './native.ts';
import type { RunResult, StatementRow, StatementSyncOptions } from './types.ts';

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;

// Sentinel to prevent direct construction
const INTERNAL = Symbol('StatementSync.internal');

const ROWID_SQL = 'SELECT last_insert_rowid()';

/**
 * `SELECT last_insert_rowid()` per connection, compiled on first need.
 *
 * Only `readBigInts` reaches it (see `#lastInsertRowid`), and then once per `run()` —
 * so it is prepared lazily, and shared across every statement of one connection rather
 * than held per `StatementSync`, where each copy would be the same query compiled again.
 */
const rowidStatements = new WeakMap<NativeDatabase, NativeStatement>();

function rowidStatement(database: NativeDatabase): NativeStatement {
    let statement = rowidStatements.get(database);
    if (!statement) {
        statement = database.prepare(ROWID_SQL);
        rowidStatements.set(database, statement);
    }
    return statement;
}

/**
 * node:sqlite reads a leading object as the named-parameter bag.
 *
 * Anything but an ArrayBufferView qualifies — an Array and a bare `ArrayBuffer` included,
 * which is why neither gets a branch of its own here or in `#bindValue`. That is
 * `args[0]->IsObject() && !args[0]->IsArrayBufferView()` in node_sqlite.cc, and a
 * narrower test would bind positionally where Node looks up names.
 */
function isNamedArgObject(arg: unknown): boolean {
    return arg !== null && typeof arg === 'object' && !ArrayBuffer.isView(arg);
}

/** The bytes of any view, without copying the ones already shaped right. */
function viewBytes(view: ArrayBufferView): Uint8Array {
    return view instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export class StatementSync {
    #database: NativeDatabase;
    #statement: NativeStatement;
    #sql: string;
    #readBigInts: boolean;
    #returnArrays: boolean;
    #allowBareNamedParameters: boolean;
    #allowUnknownNamedParameters: boolean;
    /**
     * Bare parameter name → the full name it stands for, built on the first miss.
     *
     * Full names rather than indices, because that is the map node_sqlite.cc keeps: a
     * second parameter with the SAME full name is not a conflict, and only the names can
     * tell that apart.
     */
    #bareNamedParams: Map<string, string> | null = null;

    constructor(
        sentinel: symbol,
        database: NativeDatabase,
        statement: NativeStatement,
        sql: string,
        options: StatementSyncOptions,
    ) {
        if (sentinel !== INTERNAL) {
            throw new IllegalConstructorError();
        }
        this.#database = database;
        this.#statement = statement;
        this.#sql = sql;
        this.#readBigInts = options.readBigInts ?? false;
        this.#returnArrays = options.returnArrays ?? false;
        this.#allowBareNamedParameters = options.allowBareNamedParameters ?? true;
        this.#allowUnknownNamedParameters = options.allowUnknownNamedParameters ?? false;
    }

    /** @internal */
    static _create(
        database: NativeDatabase,
        statement: NativeStatement,
        sql: string,
        options: StatementSyncOptions,
    ): StatementSync {
        return new StatementSync(INTERNAL, database, statement, sql, options);
    }

    get sourceSQL(): string {
        return this.#sql;
    }

    get expandedSQL(): string {
        // Bindings survive reset(), so this still answers for the last execution rather
        // than for a statement with every parameter cleared.
        return this.#statement.expanded_sql ?? this.#sql;
    }

    run(...args: unknown[]): RunResult {
        this.#ensureValid();
        try {
            this.#reset();
            this.#bindParams(args);
            this.#statement.step();
        } catch (e: unknown) {
            this.#reset();
            throw toSqliteError(e);
        }
        this.#reset();

        // Both counters belong to the CONNECTION, so they have to be read before anything
        // else runs on it — `#lastInsertRowid()` below is a statement of its own.
        const changes = this.#database.changes;
        if (!this.#readBigInts) {
            // node:sqlite answers with a Number here even where that rounds, unlike a
            // column value, which throws past Number.MAX_SAFE_INTEGER instead.
            return { changes, lastInsertRowid: this.#database.last_insert_rowid };
        }
        return { changes: BigInt(changes), lastInsertRowid: this.#lastInsertRowid() };
    }

    get(...args: unknown[]): StatementRow | undefined {
        const { StepResult } = nativeSqlite();
        this.#ensureValid();
        try {
            this.#reset();
            this.#bindParams(args);
            if (this.#statement.step() !== StepResult.ROW) return undefined;
            // A statement that yields no columns yields no row either, however it stepped.
            if (this.#statement.column_count === 0) return undefined;
            return this.#readRow(this.#returnArrays ? null : this.#columnNames());
        } catch (e: unknown) {
            throw toSqliteError(e);
        } finally {
            this.#reset();
        }
    }

    all(...args: unknown[]): StatementRow[] {
        const { StepResult } = nativeSqlite();
        this.#ensureValid();
        const rows: StatementRow[] = [];
        try {
            this.#reset();
            this.#bindParams(args);
            const names = this.#returnArrays ? null : this.#columnNames();
            while (this.#statement.step() === StepResult.ROW) {
                rows.push(this.#readRow(names));
            }
        } catch (e: unknown) {
            throw toSqliteError(e);
        } finally {
            this.#reset();
        }
        return rows;
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

    #ensureValid(): void {
        if (!this.#statement.is_valid) {
            throw new InvalidStateError('statement has been finalized');
        }
    }

    #reset(): void {
        this.#statement.reset();
    }

    /**
     * Resolve `args` against this statement's parameters — node_sqlite.cc's `BindParams`.
     *
     * A leading object is the named bag and is consumed first; everything after it fills
     * the ANONYMOUS parameters in order, skipping any index whose name does not start
     * with `?`. That skip is why `?3` is filled by the third argument wherever it stands
     * in the SQL, and why a statement mixing `:name` with `?` binds both.
     */
    #bindParams(args: unknown[]): void {
        const statement = this.#statement;
        statement.clear_bindings();

        let anonIndex = 1;
        let anonStart = 0;

        if (args.length > 0 && isNamedArgObject(args[0])) {
            const bag = args[0] as Record<string, unknown>;
            for (const key of Object.keys(bag)) {
                let index = statement.bind_parameter_index(key);
                if (index === 0 && this.#allowBareNamedParameters) {
                    index = this.#bareNamedIndex(key);
                }
                if (index === 0) {
                    if (this.#allowUnknownNamedParameters) continue;
                    throw new InvalidStateError(`Unknown named parameter '${key}'`);
                }
                this.#bindValue(bag[key], index);
            }
            anonStart++;
        }

        for (let i = anonStart; i < args.length; i++) {
            for (;;) {
                const name = statement.bind_parameter_name(anonIndex);
                if (name === null || name[0] === '?') break;
                anonIndex++;
            }
            this.#bindValue(args[i], anonIndex);
            anonIndex++;
        }
    }

    /** 1-based index for a name written without its `$`/`:`/`@`, or 0 for no such name. */
    #bareNamedIndex(name: string): number {
        let map = this.#bareNamedParams;
        if (!map) {
            map = new Map<string, string>();
            const statement = this.#statement;
            const count = statement.bind_parameter_count;
            for (let i = 1; i <= count; i++) {
                const full = statement.bind_parameter_name(i);
                if (full === null) continue;
                const bare = full.slice(1);
                const existing = map.get(bare);
                if (existing !== undefined) {
                    if (existing === full) continue;
                    throw new InvalidStateError(
                        `Cannot create bare named parameter '${bare}' because of conflicting names '${existing}' and '${full}'.`,
                    );
                }
                map.set(bare, full);
            }
            this.#bareNamedParams = map;
        }
        const full = map.get(name);
        return full === undefined ? 0 : this.#statement.bind_parameter_index(full);
    }

    /** node_sqlite.cc's `BindValue`, plus the two values this package has always taken. */
    #bindValue(value: unknown, index: number): void {
        const statement = this.#statement;
        if (typeof value === 'number') {
            // Every JS number binds as a double, including an integral one: that is what
            // node:sqlite does, so `run(42)` stores typeof 'real' there too.
            statement.bind_double(index, value);
        } else if (typeof value === 'string') {
            statement.bind_text(index, value);
        } else if (value === null || value === undefined) {
            // node:sqlite refused `undefined` until v26.10.0, where nodejs/node#65709 made
            // it bind NULL so an explicitly-passed `undefined` agrees with an omitted
            // parameter — which binds NULL because clear_bindings() left it there.
            statement.bind_null(index);
        } else if (ArrayBuffer.isView(value)) {
            statement.bind_blob(index, viewBytes(value));
        } else if (typeof value === 'bigint') {
            if (value > MAX_INT64 || value < MIN_INT64) {
                throw new InvalidArgValueError('BigInt value is too large to bind.');
            }
            statement.bind_int64(index, value);
        } else if (typeof value === 'boolean') {
            // A superset of node:sqlite, which REJECTS booleans outright. Kept because
            // consumers rely on it; that is also why no test asserts it — the Node half
            // of the suite would throw.
            statement.bind_int64(index, value ? 1n : 0n);
        } else {
            throw new InvalidArgTypeError(`Provided value cannot be bound to SQLite parameter ${index}.`);
        }
    }

    #columnNames(): string[] {
        const statement = this.#statement;
        const count = statement.column_count;
        return Array.from({ length: count }, (_, i) => statement.column_name(i) ?? '');
    }

    /** The current row — an array when `names` is null, an object otherwise. */
    #readRow(names: string[] | null): StatementRow {
        const { ColumnType } = nativeSqlite();
        if (names === null) {
            const count = this.#statement.column_count;
            return Array.from({ length: count }, (_, i) => this.#readColumn(ColumnType, i));
        }
        // Null prototype, like node:sqlite: a column named `__proto__` or `toString` is
        // then a plain own property rather than a collision with Object.prototype.
        const row = Object.create(null) as Record<string, unknown>;
        for (let i = 0; i < names.length; i++) {
            row[names[i]] = this.#readColumn(ColumnType, i);
        }
        return row;
    }

    #readColumn(ColumnType: NativeSqliteModule['ColumnType'], index: number): unknown {
        const statement = this.#statement;
        // Per ROW, not per column of the statement: a column with no declared type holds
        // whatever each row put there, so the storage class is the only honest answer.
        switch (statement.column_type(index)) {
            case ColumnType.NULL:
                return null;
            case ColumnType.FLOAT:
                return statement.column_double(index);
            case ColumnType.TEXT:
                return statement.column_text(index) ?? '';
            case ColumnType.BLOB:
                return new Uint8Array(statement.column_blob(index).get_data() ?? []);
            default:
                return this.#readInteger(index);
        }
    }

    /**
     * A 64-bit integer column, exactly or not at all.
     *
     * **Never `column_int64()` here.** GJS marshals a gint64 return through a double, so
     * it ROUNDS past 2^53 — and prints a `Gjs-WARNING` for every value it cannot
     * represent, one line per row. `column_double()` rounds identically without the
     * warning, and it is exact for every value inside the safe range, which is precisely
     * where "does this fit a JS number" is decided: an int64 outside it always rounds to
     * a double of magnitude ≥ 2^53, which `Number.isSafeInteger` rejects. So the probe
     * answers the question it is asked, and the exact value is then read as text.
     */
    #readInteger(index: number): number | bigint {
        const approximate = this.#statement.column_double(index);
        if (Number.isSafeInteger(approximate)) {
            return this.#readBigInts ? BigInt(approximate) : approximate;
        }
        const text = this.#statement.column_text(index) ?? '0';
        if (this.#readBigInts) return BigInt(text);
        throw new OutOfRangeError(`Value is too large to be represented as a JavaScript number: ${text}`);
    }

    /**
     * The last insert rowid as an exact BigInt.
     *
     * The GObject property is an int64 GJS hands over as a Number, so a rowid past 2^53
     * arrives rounded — which is the one thing `readBigInts` exists to prevent. SQLite's
     * own function renders it exactly as text, so under `readBigInts` the answer comes
     * from a statement rather than from the property.
     */
    #lastInsertRowid(): bigint {
        const { StepResult } = nativeSqlite();
        const statement = rowidStatement(this.#database);
        try {
            if (statement.step() !== StepResult.ROW) {
                throw new SqliteError(`${ROWID_SQL} returned no row`);
            }
            return BigInt(statement.column_text(0) ?? '0');
        } finally {
            statement.reset();
        }
    }
}
