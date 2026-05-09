
/**
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in `ts-for-gir` or create a bug report on https://github.com/gjsify/ts-for-gir
 *
 * The based EJS template file is used for the generated .d.ts file of each GIR module like Gtk-4.0, GObject-2.0, ...
 */

declare module 'gi://GjsifyHttp2?version=1.0' {

// Module dependencies
import type GLib from '@girs/glib-2.0';
import type GObject from '@girs/gobject-2.0';

export namespace GjsifyHttp2 {

    /**
     * GjsifyHttp2-1.0
     */


    namespace FrameEncoder {
        // Signal signatures
        interface SignalSignatures extends GObject.Object.SignalSignatures {
        }

        // Constructor properties interface
        interface ConstructorProps extends GObject.Object.ConstructorProps {

        }
    }

    /**
     * @gir-type Class
     */
    class FrameEncoder extends GObject.Object {
        static $gtype: GObject.GType<FrameEncoder>;

        /**
         * Compile-time signal type information.
         *
         * This instance property is generated only for TypeScript type checking.
         * It is not defined at runtime and should not be accessed in JS code.
         * @internal
         */
        $signals: FrameEncoder.SignalSignatures;

        // Constructors
        constructor(properties?: Partial<FrameEncoder.ConstructorProps>, ...args: any[]);

        _init(...args: any[]): void;

        static ["new"](): FrameEncoder;

        // Signals
        /** @signal */
        connect<K extends keyof FrameEncoder.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, FrameEncoder.SignalSignatures[K]>): number;
        connect(signal: string, callback: (...args: any[]) => any): number;

        /** @signal */
        connect_after<K extends keyof FrameEncoder.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, FrameEncoder.SignalSignatures[K]>): number;
        connect_after(signal: string, callback: (...args: any[]) => any): number;

        /** @signal */
        emit<K extends keyof FrameEncoder.SignalSignatures>(signal: K, ...args: GObject.GjsParameters<FrameEncoder.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never): void;
        emit(signal: string, ...args: any[]): void;

        // Methods
        /**
         * @param names 
         * @param values 
         */
        encode_headers(names: string[], values: string[]): (GLib.Bytes | null);

        /**
         * @param stream_id 
         * @param end_stream 
         * @param payload 
         */
        build_data_frame(stream_id: number, end_stream: boolean, payload: (GLib.Bytes | Uint8Array)): GLib.Bytes;

        /**
         * @param stream_id 
         * @param end_stream 
         * @param end_headers 
         * @param header_block 
         */
        build_headers_frame(stream_id: number, end_stream: boolean, end_headers: boolean, header_block: (GLib.Bytes | Uint8Array)): GLib.Bytes;

        /**
         * @param associated_stream_id 
         * @param promised_stream_id 
         * @param header_block 
         */
        build_push_promise(associated_stream_id: number, promised_stream_id: number, header_block: (GLib.Bytes | Uint8Array)): GLib.Bytes;

        nghttp2_version(): string;
    }


    namespace StreamIdAllocator {
        // Signal signatures
        interface SignalSignatures extends GObject.Object.SignalSignatures {
            "notify::last-client-stream-id": (pspec: GObject.ParamSpec) => void;
            "notify::remaining-pushes": (pspec: GObject.ParamSpec) => void;
        }

        // Constructor properties interface
        interface ConstructorProps extends GObject.Object.ConstructorProps {
            last_client_stream_id: number;
            lastClientStreamId: number;
            remaining_pushes: number;
            remainingPushes: number;
        }
    }

    /**
     * @gir-type Class
     */
    class StreamIdAllocator extends GObject.Object {
        static $gtype: GObject.GType<StreamIdAllocator>;

        // Properties
        /**
         * @read-only
         */
        get last_client_stream_id(): number;

        /**
         * @read-only
         */
        get lastClientStreamId(): number;

        /**
         * @read-only
         */
        get remaining_pushes(): number;

        /**
         * @read-only
         */
        get remainingPushes(): number;

        /**
         * Compile-time signal type information.
         *
         * This instance property is generated only for TypeScript type checking.
         * It is not defined at runtime and should not be accessed in JS code.
         * @internal
         */
        $signals: StreamIdAllocator.SignalSignatures;

        // Constructors
        constructor(properties?: Partial<StreamIdAllocator.ConstructorProps>, ...args: any[]);

        _init(...args: any[]): void;

        static ["new"](): StreamIdAllocator;

        // Signals
        /** @signal */
        connect<K extends keyof StreamIdAllocator.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, StreamIdAllocator.SignalSignatures[K]>): number;
        connect(signal: string, callback: (...args: any[]) => any): number;

        /** @signal */
        connect_after<K extends keyof StreamIdAllocator.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, StreamIdAllocator.SignalSignatures[K]>): number;
        connect_after(signal: string, callback: (...args: any[]) => any): number;

        /** @signal */
        emit<K extends keyof StreamIdAllocator.SignalSignatures>(signal: K, ...args: GObject.GjsParameters<StreamIdAllocator.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never): void;
        emit(signal: string, ...args: any[]): void;

        // Methods
        next_promised(): number;

        /**
         * @param id 
         */
        record_client_stream(id: number): void;

        get_last_client_stream_id(): number;

        get_remaining_pushes(): number;
    }


    namespace SessionBridge {
        // Signal signatures
        interface SignalSignatures extends GObject.Object.SignalSignatures {
        }

        // Constructor properties interface
        interface ConstructorProps extends GObject.Object.ConstructorProps {

        }
    }

    /**
     * @gir-type Class
     */
    class SessionBridge extends GObject.Object {
        static $gtype: GObject.GType<SessionBridge>;

        /**
         * Compile-time signal type information.
         *
         * This instance property is generated only for TypeScript type checking.
         * It is not defined at runtime and should not be accessed in JS code.
         * @internal
         */
        $signals: SessionBridge.SignalSignatures;

        // Constructors
        constructor(properties?: Partial<SessionBridge.ConstructorProps>, ...args: any[]);

        _init(...args: any[]): void;

        static ["new"](): SessionBridge;

        // Signals
        /** @signal */
        connect<K extends keyof SessionBridge.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, SessionBridge.SignalSignatures[K]>): number;
        connect(signal: string, callback: (...args: any[]) => any): number;

        /** @signal */
        connect_after<K extends keyof SessionBridge.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, SessionBridge.SignalSignatures[K]>): number;
        connect_after(signal: string, callback: (...args: any[]) => any): number;

        /** @signal */
        emit<K extends keyof SessionBridge.SignalSignatures>(signal: K, ...args: GObject.GjsParameters<SessionBridge.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never): void;
        emit(signal: string, ...args: any[]): void;

        // Static methods
        /**
         * @param bytes 
         */
        static is_client_preface(bytes: (GLib.Bytes | null)): boolean;

        static preface_length(): number;
    }


    /**
     * @gir-type Alias
     */
    type FrameEncoderClass = typeof FrameEncoder;

    /**
     * @gir-type Struct
     */
    abstract class FrameEncoderPrivate {
        static $gtype: GObject.GType<FrameEncoderPrivate>;
    }


    /**
     * @gir-type Alias
     */
    type StreamIdAllocatorClass = typeof StreamIdAllocator;

    /**
     * @gir-type Struct
     */
    abstract class StreamIdAllocatorPrivate {
        static $gtype: GObject.GType<StreamIdAllocatorPrivate>;
    }


    /**
     * @gir-type Alias
     */
    type SessionBridgeClass = typeof SessionBridge;

    /**
     * @gir-type Struct
     */
    abstract class SessionBridgePrivate {
        static $gtype: GObject.GType<SessionBridgePrivate>;
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

export default GjsifyHttp2;

}

declare module 'gi://GjsifyHttp2' {
    import GjsifyHttp210 from 'gi://GjsifyHttp2?version=1.0';
    export default GjsifyHttp210;
}
// END
