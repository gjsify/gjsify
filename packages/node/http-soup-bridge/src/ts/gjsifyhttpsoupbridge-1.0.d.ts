/**
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in `ts-for-gir` or create a bug report on https://github.com/gjsify/ts-for-gir
 *
 * The based EJS template file is used for the generated .d.ts file of each GIR module like Gtk-4.0, GObject-2.0, ...
 */

declare module 'gi://GjsifyHttpSoupBridge?version=1.0' {
    // Module dependencies
    import type GLib from '@girs/glib-2.0';
    import type Gio from '@girs/gio-2.0';
    import type GObject from '@girs/gobject-2.0';
    import type GModule from '@girs/gmodule-2.0';
    import type Soup from '@girs/soup-3.0';

    export namespace GjsifyHttpSoupBridge {
        /**
         * GjsifyHttpSoupBridge-1.0
         */

        namespace Response {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                /**
                 * @signal
                 */
                close: () => void;
                /**
                 * @signal
                 */
                drain: () => void;
                'notify::status-code': (pspec: GObject.ParamSpec) => void;
                'notify::status-message': (pspec: GObject.ParamSpec) => void;
                'notify::headers-sent': (pspec: GObject.ParamSpec) => void;
                'notify::finished': (pspec: GObject.ParamSpec) => void;
                'notify::aborted': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface

            interface ConstructorProps extends GObject.Object.ConstructorProps {
                status_code: number;
                statusCode: number;
                status_message: string;
                statusMessage: string;
                headers_sent: boolean;
                headersSent: boolean;
                finished: boolean;
                aborted: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class Response extends GObject.Object {
            static $gtype: GObject.GType<Response>;

            // Properties

            get status_code(): number;
            set status_code(val: number);
            get statusCode(): number;
            set statusCode(val: number);
            get status_message(): string;
            set status_message(val: string);
            get statusMessage(): string;
            set statusMessage(val: string);
            get headers_sent(): boolean;
            set headers_sent(val: boolean);
            get headersSent(): boolean;
            set headersSent(val: boolean);
            get finished(): boolean;
            set finished(val: boolean);
            get aborted(): boolean;
            set aborted(val: boolean);

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: Response.SignalSignatures;

            // Constructors

            constructor(properties?: Partial<Response.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            // Signals

            /** @signal */
            connect<K extends keyof Response.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Response.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;
            /** @signal */
            connect_after<K extends keyof Response.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Response.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;
            /** @signal */
            emit<K extends keyof Response.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<Response.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods

            /**
             * @param name
             * @param value
             */
            set_header(name: string, value: string): void;
            /**
             * @param name
             * @param value
             */
            append_header(name: string, value: string): void;
            /**
             * @param name
             */
            remove_header(name: string): void;
            /**
             * @param name
             */
            get_header(name: string): string | null;
            header_names(): string[];
            /**
             * @param code
             * @param reason
             */
            write_head(code: number, reason?: string | null): void;
            /**
             * @param chunk
             */
            write_chunk(chunk: Uint8Array | string): boolean;
            end(): void;
            /**
             * @param chunk
             */
            end_with(chunk: Uint8Array | string): void;
            abort(): void;
            get_status_code(): number;
            /**
             * @param value
             */
            set_status_code(value: number): void;
            get_status_message(): string;
            /**
             * @param value
             */
            set_status_message(value: string): void;
            get_headers_sent(): boolean;
            get_finished(): boolean;
            get_aborted(): boolean;
        }

        namespace Request {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                /**
                 * @signal
                 */
                'aborted-signal': () => void;
                /**
                 * @signal
                 */
                close: () => void;
                'notify::method': (pspec: GObject.ParamSpec) => void;
                'notify::url': (pspec: GObject.ParamSpec) => void;
                'notify::remote-address': (pspec: GObject.ParamSpec) => void;
                'notify::remote-port': (pspec: GObject.ParamSpec) => void;
                'notify::header-pairs': (pspec: GObject.ParamSpec) => void;
                'notify::aborted': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface

            interface ConstructorProps extends GObject.Object.ConstructorProps {
                method: string;
                url: string;
                remote_address: string;
                remoteAddress: string;
                remote_port: number;
                remotePort: number;
                header_pairs: string[];
                headerPairs: string[];
                aborted: boolean;
            }
        }

        /**
         * @gir-type Class
         */
        class Request extends GObject.Object {
            static $gtype: GObject.GType<Request>;

            // Properties

            get method(): string;
            set method(val: string);
            get url(): string;
            set url(val: string);
            get remote_address(): string;
            set remote_address(val: string);
            get remoteAddress(): string;
            set remoteAddress(val: string);
            get remote_port(): number;
            set remote_port(val: number);
            get remotePort(): number;
            set remotePort(val: number);
            get header_pairs(): string[];
            set header_pairs(val: string[]);
            get headerPairs(): string[];
            set headerPairs(val: string[]);
            get aborted(): boolean;
            set aborted(val: boolean);

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: Request.SignalSignatures;

            // Constructors

            constructor(properties?: Partial<Request.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            // Signals

            /** @signal */
            connect<K extends keyof Request.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Request.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;
            /** @signal */
            connect_after<K extends keyof Request.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Request.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;
            /** @signal */
            emit<K extends keyof Request.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<Request.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods

            get_body(): Uint8Array;
            get_method(): string;
            get_url(): string;
            get_remote_address(): string;
            get_remote_port(): number;
            get_header_pairs(): string[];
            get_aborted(): boolean;
        }

        namespace Server {
            // Signal signatures
            interface SignalSignatures extends GObject.Object.SignalSignatures {
                /**
                 * @signal
                 */
                'request-received': (arg0: Request, arg1: Response) => void;
                /**
                 * @signal
                 */
                upgrade: (arg0: Request, arg1: Gio.IOStream, arg2: GLib.Bytes) => void;
                /**
                 * @signal
                 */
                'error-occurred': (arg0: string) => void;
                'notify::port': (pspec: GObject.ParamSpec) => void;
                'notify::address': (pspec: GObject.ParamSpec) => void;
                'notify::listening': (pspec: GObject.ParamSpec) => void;
                'notify::soup-server': (pspec: GObject.ParamSpec) => void;
            }

            // Constructor properties interface

            interface ConstructorProps extends GObject.Object.ConstructorProps {
                port: number;
                address: string;
                listening: boolean;
                soup_server: Soup.Server;
                soupServer: Soup.Server;
            }
        }

        /**
         * @gir-type Class
         */
        class Server extends GObject.Object {
            static $gtype: GObject.GType<Server>;

            // Properties

            get port(): number;
            set port(val: number);
            get address(): string;
            set address(val: string);
            get listening(): boolean;
            set listening(val: boolean);
            get soup_server(): Soup.Server;
            set soup_server(val: Soup.Server);
            get soupServer(): Soup.Server;
            set soupServer(val: Soup.Server);

            /**
             * Compile-time signal type information.
             *
             * This instance property is generated only for TypeScript type checking.
             * It is not defined at runtime and should not be accessed in JS code.
             * @internal
             */
            $signals: Server.SignalSignatures;

            // Constructors

            constructor(properties?: Partial<Server.ConstructorProps>, ...args: any[]);

            _init(...args: any[]): void;

            static ['new'](): Server;

            // Signals

            /** @signal */
            connect<K extends keyof Server.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Server.SignalSignatures[K]>,
            ): number;
            connect(signal: string, callback: (...args: any[]) => any): number;
            /** @signal */
            connect_after<K extends keyof Server.SignalSignatures>(
                signal: K,
                callback: GObject.SignalCallback<this, Server.SignalSignatures[K]>,
            ): number;
            connect_after(signal: string, callback: (...args: any[]) => any): number;
            /** @signal */
            emit<K extends keyof Server.SignalSignatures>(
                signal: K,
                ...args: GObject.GjsParameters<Server.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never
            ): void;
            emit(signal: string, ...args: any[]): void;

            // Methods

            /**
             * @param port_arg
             * @param hostname
             */
            listen(port_arg: number, hostname: string): void;
            close(): void;
            get_port(): number;
            get_address(): string;
            get_listening(): boolean;
            get_soup_server(): Soup.Server;
        }

        /**
         * @gir-type Alias
         */
        type ResponseClass = typeof Response;
        /**
         * @gir-type Struct
         */
        abstract class ResponsePrivate {
            static $gtype: GObject.GType<ResponsePrivate>;
        }

        /**
         * @gir-type Alias
         */
        type RequestClass = typeof Request;
        /**
         * @gir-type Struct
         */
        abstract class RequestPrivate {
            static $gtype: GObject.GType<RequestPrivate>;
        }

        /**
         * @gir-type Alias
         */
        type ServerClass = typeof Server;
        /**
         * @gir-type Struct
         */
        abstract class ServerPrivate {
            static $gtype: GObject.GType<ServerPrivate>;
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

    export default GjsifyHttpSoupBridge;
}

declare module 'gi://GjsifyHttpSoupBridge' {
    import GjsifyHttpSoupBridge10 from 'gi://GjsifyHttpSoupBridge?version=1.0';
    export default GjsifyHttpSoupBridge10;
}
// END
