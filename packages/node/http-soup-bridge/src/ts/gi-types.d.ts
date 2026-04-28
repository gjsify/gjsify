// Hand-written ambient declarations for `gi://GjsifyHttpSoupBridge?version=1.0`.
//
// We could regenerate these from the freshly-built `.gir` via
// `ts-for-gir generate` (see README.md), but ts-for-gir's output is a full
// `@girs/gjsifyhttpsoupbridge-1.0` package tree that depends on system GIR
// files (`/usr/share/gir-1.0/{Soup-3.0,Gio-2.0,GLib-2.0,GObject-2.0}.gir`)
// being available at type-generation time. Running it in CI would mean
// installing libsoup3-devel + gobject-introspection-devel just to typecheck
// this package — heavyweight and brittle.
//
// The bridge surface is small (three classes, no inheritance trees of our
// own, all parameter types are GLib / Gio / Soup primitives we already have
// types for). Hand-writing the ambient module keeps `tsc --noEmit` working
// in any environment without a Vala toolchain.
//
// When `@girs/gjsifyhttpsoupbridge-1.0` is published to npm (see README.md
// "TS types"), this file becomes redundant and should be replaced by the
// usual `import GjsifyHttpSoupBridge from 'gi://GjsifyHttpSoupBridge?version=1.0'`
// path that loads the published types.

declare module 'gi://GjsifyHttpSoupBridge?version=1.0' {
    import GObject from '@girs/gobject-2.0';
    import Gio from '@girs/gio-2.0';

    namespace GjsifyHttpSoupBridge {
        class Server extends GObject.Object {
            readonly port: number;
            readonly address: string;
            readonly listening: boolean;
            readonly soup_server: GObject.Object;

            constructor();

            /** Throws a GLib.Error (Gio.IOErrorEnum) on bind failure (e.g. EADDRINUSE / EACCES). */
            listen(port: number, hostname: string): void;
            close(): void;

            connect(signal: 'request-received', cb: (self: Server, req: Request, res: Response) => void): number;
            connect(signal: 'upgrade', cb: (self: Server, req: Request, iostream: Gio.IOStream, head: Uint8Array) => void): number;
            connect(signal: 'error-occurred', cb: (self: Server, message: string) => void): number;
            connect(signal: string, cb: (...args: unknown[]) => void): number;

            disconnect(handlerId: number): void;
        }

        class Request extends GObject.Object {
            readonly method: string;
            readonly url: string;
            readonly remote_address: string;
            readonly remote_port: number;
            readonly header_pairs: string[];
            readonly aborted: boolean;

            get_body(): Uint8Array;

            connect(signal: 'aborted_signal', cb: (self: Request) => void): number;
            connect(signal: 'close', cb: (self: Request) => void): number;
            connect(signal: string, cb: (...args: unknown[]) => void): number;

            disconnect(handlerId: number): void;
        }

        class Response extends GObject.Object {
            status_code: number;
            status_message: string;
            readonly headers_sent: boolean;
            readonly finished: boolean;
            readonly aborted: boolean;

            set_header(name: string, value: string): void;
            append_header(name: string, value: string): void;
            remove_header(name: string): void;
            get_header(name: string): string | null;
            header_names(): string[];

            write_head(code: number, reason: string | null): void;
            write_chunk(chunk: Uint8Array): boolean;
            end(): void;
            end_with(chunk: Uint8Array): void;
            abort(): void;

            connect(signal: 'drain', cb: (self: Response) => void): number;
            connect(signal: 'close', cb: (self: Response) => void): number;
            connect(signal: string, cb: (...args: unknown[]) => void): number;

            disconnect(handlerId: number): void;
        }
    }

    const GjsifyHttpSoupBridge: {
        Server: typeof GjsifyHttpSoupBridge.Server;
        Request: typeof GjsifyHttpSoupBridge.Request;
        Response: typeof GjsifyHttpSoupBridge.Response;
    };

    export default GjsifyHttpSoupBridge;
}
