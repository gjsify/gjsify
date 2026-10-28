/**
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in `ts-for-gir` or create a bug report on https://github.com/gjsify/ts-for-gir
 *
 * The based EJS template file is used for the generated .d.ts file of each GIR module like Gtk-4.0, GObject-2.0, ...
 */

declare module 'gi://GjsifySqlite?version=1.0' {
    // Module dependencies
    import type GLib from '@girs/glib-2.0';
    import type GObject from '@girs/gobject-2.0';

    export namespace GjsifySqlite {
        /**
         * GjsifySqlite-1.0
         */

        /**
         * @gir-type Enum
         */
        export namespace OpenMode {
            export const $gtype: GObject.GType<OpenMode>;
        }

        /**
         * @gir-type Enum
         */
        enum OpenMode {
            READONLY,
            READWRITE,
            READWRITE_CREATE,
        }

        /**
         * @gir-type Enum
         */
        export namespace StepResult {
            export const $gtype: GObject.GType<StepResult>;
        }

        /**
         * @gir-type Enum
         */
        enum StepResult {
            ROW,
            DONE,
        }

        /**
         * @gir-type Enum
         */
        export namespace ColumnType {
            export const $gtype: GObject.GType<ColumnType>;
        }

        /**
         * @gir-type Enum
         */
        enum ColumnType {
            INTEGER,
            FLOAT,
            TEXT,
            BLOB,
            NULL,
        }

        /**
         * @gir-type Struct
         */
        class SqliteError extends GLib.Error {
            static $gtype: GObject.GType<GLib.Error>;

            // Static fields
            static FAILED: number;

            // Constructors
            constructor(options: { message: string; code: number });
        }

        namespace Database {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                'notify::is-open': (pspec: GObject.ParamSpec) => void;
                'notify::last-insert-rowid': (pspec: GObject.ParamSpec) => void;
                'notify::changes': (pspec: GObject.ParamSpec) => void;
                'notify::in-transaction': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface
            interface ConstructorProps extends GObject.Object.ConstructorProps {
                is_open: boolean;
                isOpen: boolean;
                last_insert_rowid: bigint | number;
                lastInsertRowid: bigint | number;
                changes: bigint | number;
                in_transaction: boolean;
                inTransaction: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class Database extends GObject.Object {
            static $gtype: GObject.GType<Database>;

            // Properties
            /**
             * @read-only
             */
            get is_open(): boolean;

            /**
             * @read-only
             */
            get isOpen(): boolean;

            /**
             * @read-only
             */
            get last_insert_rowid(): number;

            /**
             * @read-only
             */
            get lastInsertRowid(): number;

            /**
             * @read-only
             */
            get changes(): number;

            /**
             * @read-only
             */
            get in_transaction(): boolean;

            /**
             * @read-only
             */
            get inTransaction(): boolean;

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: Database.SignalSignatures;

            // Constructors
            constructor(properties?: Partial<Database.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            static ['new'](): Database;

            // Signals
            /** @signal */
            connect<K extends keyof Database.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Database.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            connect_after<K extends keyof Database.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Database.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            emit<K extends keyof Database.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<Database.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Static methods
            /**
             * @param path
             * @param mode
             * @param uri
             */
            static open(path: string, mode: OpenMode, uri: boolean): Database;

            // Methods
            /**
             * @param sql
             */
            exec(sql: string): void;

            /**
             * @param sql
             */
            prepare(sql: string): Statement;

            close(): void;

            get_is_open(): boolean;

            get_last_insert_rowid(): number;

            get_changes(): number;

            get_in_transaction(): boolean;
        }

        namespace Statement {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                'notify::is-valid': (pspec: GObject.ParamSpec) => void;
                'notify::column-count': (pspec: GObject.ParamSpec) => void;
                'notify::bind-parameter-count': (pspec: GObject.ParamSpec) => void;
                'notify::sql': (pspec: GObject.ParamSpec) => void;
                'notify::expanded-sql': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface
            interface ConstructorProps extends GObject.Object.ConstructorProps {
                is_valid: boolean;
                isValid: boolean;
                column_count: number;
                columnCount: number;
                bind_parameter_count: number;
                bindParameterCount: number;
                sql: string | null;
                expanded_sql: string | null;
                expandedSql: string;
            }
        }

        /**
         * @gir-type Class
         */
        class Statement extends GObject.Object {
            static $gtype: GObject.GType<Statement>;

            // Properties
            /**
             * @read-only
             */
            get is_valid(): boolean;

            /**
             * @read-only
             */
            get isValid(): boolean;

            /**
             * @read-only
             */
            get column_count(): number;

            /**
             * @read-only
             */
            get columnCount(): number;

            /**
             * @read-only
             */
            get bind_parameter_count(): number;

            /**
             * @read-only
             */
            get bindParameterCount(): number;

            /**
             * @read-only
             */
            get sql(): string | null;

            /**
             * @read-only
             */
            get expanded_sql(): string | null;

            /**
             * @read-only
             */
            get expandedSql(): string;

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: Statement.SignalSignatures;

            // Constructors
            constructor(properties?: Partial<Statement.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            // Signals
            /** @signal */
            connect<K extends keyof Statement.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Statement.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            connect_after<K extends keyof Statement.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Statement.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;

            /** @signal */
            emit<K extends keyof Statement.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<Statement.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods
            close(): void;

            /**
             * @param index
             */
            bind_null(index: number): void;

            /**
             * @param index
             * @param value
             */
            bind_int64(index: number, value: bigint | number): void;

            /**
             * @param index
             * @param value
             */
            bind_double(index: number, value: number): void;

            /**
             * @param index
             * @param value
             */
            bind_text(index: number, value: string): void;

            /**
             * @param index
             * @param value
             */
            bind_blob(index: number, value: GLib.Bytes | Uint8Array): void;

            /**
             * @param name
             */
            bind_parameter_index(name: string): number;

            /**
             * @param index
             */
            bind_parameter_name(index: number): string | null;

            clear_bindings(): void;

            step(): StepResult;

            reset(): void;

            /**
             * @param index
             */
            column_name(index: number): string | null;

            /**
             * @param index
             */
            column_decltype(index: number): string | null;

            /**
             * @param index
             */
            column_type(index: number): ColumnType;

            /**
             * @param index
             */
            column_int64(index: number): number;

            /**
             * @param index
             */
            column_double(index: number): number;

            /**
             * @param index
             */
            column_text(index: number): string | null;

            /**
             * @param index
             */
            column_blob(index: number): GLib.Bytes;

            get_is_valid(): boolean;

            get_column_count(): number;

            get_bind_parameter_count(): number;

            get_sql(): string | null;

            get_expanded_sql(): string | null;
        }

        /**
         * @gir-type Alias
         */
        type DatabaseClass = typeof Database;

        /**
         * @gir-type Struct
         */
        abstract class DatabasePrivate {
            static $gtype: GObject.GType<DatabasePrivate>;
        }

        /**
         * @gir-type Alias
         */
        type StatementClass = typeof Statement;

        /**
         * @gir-type Struct
         */
        abstract class StatementPrivate {
            static $gtype: GObject.GType<StatementPrivate>;
        }

        /**
         * Name of the imported GIR library
         * `see` https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L188
         */
        const __name__: string;

        /**
         * Version of the imported GIR library
         * `see` https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L189
         */
        const __version__: string;
    }

    export default GjsifySqlite;
}

declare module 'gi://GjsifySqlite' {
    import GjsifySqlite10 from 'gi://GjsifySqlite?version=1.0';
    export default GjsifySqlite10;
}
// END
