// Reference: refs/ws/lib/stream.js
// Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>. MIT.
// Adapted for @gjsify/ws — WebSocket → Node.js Duplex bridge without _socket dependency.

import { Duplex } from 'node:stream';
import type { WebSocket } from './websocket.js';

/** Structural subset of a `ws.WebSocket` we read in the Duplex bridge. Includes
 *  the two server-side wrappers in this package (the public `WebSocket` client
 *  and the private `ServerSideWebSocket` from `websocket-server.ts`) plus any
 *  other ws-compatible class — typed structurally so the bridge stays drop-in
 *  for the npm `ws` semantics (`ws.on(event, …)`/`ws.send(…)`/`ws.close()`/`ws.terminate()`
 *  + the readyState constants both as instance and static fields). */
interface WSLike {
    readyState: number;
    readonly CONNECTING: number;
    readonly OPEN: number;
    readonly CLOSING: number;
    readonly CLOSED: number;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    once(event: string, listener: (...args: unknown[]) => void): unknown;
    send(data: string | Buffer, cb?: (err?: Error) => void): void;
    close(): void;
    terminate(): void;
    pause?(): void;
    resume?(): void;
}

// Internal Duplex hooks/state we reach into to bridge a WebSocket. None of
// these are part of `@types/node`'s public Duplex surface — they're the
// documented protected hooks (`_destroy`, `_final`) Node's stream impl calls
// for subclasses, plus `_writableState.finished` for the end-of-stream probe.
interface _DuplexInternals {
    _writableState?: { finished: boolean };
    _destroy?: (err: Error | null, callback: (err: Error | null) => void) => void;
    _final?: (callback: () => void) => void;
}

function emitClose(stream: Duplex): void {
    stream.emit('close');
}

function duplexOnEnd(this: Duplex): void {
    if (!this.destroyed && (this as Duplex & _DuplexInternals)._writableState?.finished) {
        this.destroy();
    }
}

function duplexOnError(this: Duplex, err: Error): void {
    this.removeListener('error', duplexOnError);
    this.destroy();
    if (this.listenerCount('error') === 0) {
        this.emit('error', err);
    }
}

export function createWebSocketStream(ws: WebSocket | WSLike, options: Record<string, unknown> = {}): Duplex {
    let terminateOnDestroy = true;
    // Internal handle typed structurally — the public surface accepts the
    // package's own `WebSocket` (for client-side bridging) or any ws-compatible
    // object (matches npm `ws` semantics where server-side accepted sockets are
    // also valid).
    const sock = ws as WSLike;

    const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false,
    });

    sock.on('message', (...args: unknown[]) => {
        const msg = args[0] as Buffer | string;
        const isBinary = args[1] as boolean;
        let data: Buffer | string;
        if (isBinary || duplex.readableObjectMode) {
            data = msg;
        } else {
            data = typeof msg === 'string' ? Buffer.from(msg) : msg;
        }
        if (!duplex.push(data) && typeof sock.pause === 'function') sock.pause();
    });

    sock.once('error', (...args: unknown[]) => {
        const err = args[0] as Error;
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
    });

    sock.once('close', () => {
        if (duplex.destroyed) return;
        duplex.push(null);
    });

    const _duplexInternal = duplex as Duplex & _DuplexInternals;
    _duplexInternal._destroy = function (err: Error | null, callback: (err: Error | null) => void): void {
        if (sock.readyState === sock.CLOSED) {
            callback(err);
            process.nextTick(emitClose, duplex);
            return;
        }

        let called = false;

        sock.once('error', (...args: unknown[]) => {
            const e = args[0] as Error;
            called = true;
            callback(e);
        });

        sock.once('close', () => {
            if (!called) callback(err);
            process.nextTick(emitClose, duplex);
        });

        if (terminateOnDestroy) sock.terminate();
    };

    _duplexInternal._final = function (callback: () => void): void {
        if (sock.readyState === sock.CONNECTING) {
            sock.once('open', () => _duplexInternal._final!(callback));
            return;
        }
        if (sock.readyState === sock.CLOSED || sock.readyState === sock.CLOSING) {
            callback();
            return;
        }
        sock.once('close', () => callback());
        sock.close();
    };

    duplex._read = function (): void {
        if (typeof sock.resume === 'function') sock.resume();
    };

    duplex._write = function (
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (err?: Error) => void,
    ): void {
        if (sock.readyState === sock.CONNECTING) {
            sock.once('open', () => duplex._write(chunk, _encoding, callback));
            return;
        }
        sock.send(chunk, callback);
    };

    duplex.on('end', duplexOnEnd);
    duplex.on('error', duplexOnError);
    return duplex;
}
