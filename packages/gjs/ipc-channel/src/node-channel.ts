// SPDX-License-Identifier: MIT
// Node's IPC channel on one end of a connected stream socket: what `fork` gives
// the parent's `ChildProcess` and the child's `process` (ADR 0133). Node runs
// one `setupChannel` for both sides, and so does this module: `send`,
// `disconnect`, `connected`, `channel` and the `'message'` / `'disconnect'`
// events behave the same on either end.
//
// Only `serialization: 'json'` — Node's own wire, one JSON text plus `\n` —
// so either side may be a Node process.

import { gio } from './gi.ts';
import { acquireMainLoop, releaseMainLoop } from '@gjsify/utils/main-loop';
import { LineChannel } from './line-channel.ts';

/** The emitter surface a channel is installed on; `ChildProcess` and `process` both fit. */
export interface NodeChannelTarget {
    connected?: boolean;
    emit(event: string, ...args: unknown[]): boolean;
    on(event: string, listener: (...args: any[]) => void): unknown;
    once(event: string, listener: (...args: any[]) => void): unknown;
    listenerCount(event: string): number;
}

export type SendCallback = (error: Error | null) => void;

/** `target.channel`, as Node shapes it. */
export interface NodeChannelHandle {
    readonly fd: number;
    ref(): void;
    unref(): void;
}

function codedError(Ctor: ErrorConstructor, code: string, message: string): Error & { code: string } {
    const err = new Ctor(message) as Error & { code: string };
    err.code = code;
    return err;
}

/**
 * Node routes a message whose `cmd` starts with `NODE_` to `'internalMessage'`
 * (handle passing, cluster), never to `'message'`.
 */
export function isInternalMessage(message: unknown): boolean {
    if (message === null || typeof message !== 'object') return false;
    const cmd = (message as { cmd?: unknown }).cmd;
    return typeof cmd === 'string' && cmd.length > 4 && cmd.startsWith('NODE_');
}

/**
 * Install Node's channel API on `target` over the connected stream socket `fd`,
 * which this call takes ownership of, and start reading.
 *
 * The channel holds the main loop while it is connected, not `unref()`ed, and
 * `target` has a `'message'` or `'disconnect'` listener. Measured on Node 24: a
 * forked child with either listener stays alive, a child with neither exits.
 */
export function setupNodeChannel(target: NodeChannelTarget, fd: number): NodeChannelHandle {
    const socket = gio().Socket.new_from_fd(fd);
    // A socket connection's streams send with MSG_NOSIGNAL, so a peer that is
    // already gone surfaces as EPIPE on the write instead of killing us.
    const connection = socket.connection_factory_create_connection();
    const lines = new LineChannel(connection.get_output_stream(), connection.get_input_stream());

    let open = true;
    let refed = true;
    let holding = false;

    const updateHold = (): void => {
        const want = open && refed && target.listenerCount('message') + target.listenerCount('disconnect') > 0;
        if (want === holding) return;
        holding = want;
        if (want) acquireMainLoop();
        else releaseMainLoop();
    };
    // `newListener` fires before the listener is added, so look one tick later.
    target.on('newListener', (event: string) => {
        if (event === 'message' || event === 'disconnect') queueMicrotask(updateHold);
    });
    target.on('removeListener', (event: string) => {
        if (event === 'message' || event === 'disconnect') queueMicrotask(updateHold);
    });

    let reading = true;
    const release = (): void => {
        try {
            socket.close();
        } catch {
            // Already closed.
        }
    };
    const close = (): void => {
        if (!open) return;
        open = false;
        target.connected = false;
        (target as { channel?: unknown }).channel = null;
        // Closing the connection with a read in flight fails with PENDING, and
        // closing the bare fd under it leaves the read to an EBADF. A shutdown
        // ends the read with EOF instead; the read loop's end then frees the fd.
        try {
            socket.shutdown(true, true);
        } catch {
            // The peer may have closed first.
        }
        if (!reading) release();
        queueMicrotask(() => {
            target.emit('disconnect');
            updateHold();
        });
    };

    const send = (message: unknown, handle?: unknown, options?: unknown, callback?: unknown): boolean => {
        if (typeof handle === 'function') {
            callback = handle;
            handle = undefined;
        } else if (typeof options === 'function') {
            callback = options;
        }
        const cb = typeof callback === 'function' ? (callback as SendCallback) : undefined;
        if (!open) {
            const err = codedError(Error, 'ERR_IPC_CHANNEL_CLOSED', 'Channel closed');
            if (cb) queueMicrotask(() => cb(err));
            else queueMicrotask(() => target.emit('error', err));
            return false;
        }
        if (message === undefined) {
            throw codedError(TypeError, 'ERR_MISSING_ARGS', 'The "message" argument must be specified');
        }
        if (!['string', 'object', 'number', 'boolean'].includes(typeof message)) {
            throw codedError(
                TypeError,
                'ERR_INVALID_ARG_TYPE',
                `The "message" argument must be one of type string, object, number, or boolean. Received type ${typeof message}`,
            );
        }
        if (handle !== undefined && handle !== null) {
            throw codedError(
                Error,
                'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM',
                'Sending a handle over the IPC channel is not supported under GJS',
            );
        }
        try {
            lines.send(message);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            if (cb) queueMicrotask(() => cb(err));
            else queueMicrotask(() => target.emit('error', err));
            return false;
        }
        if (cb) queueMicrotask(() => cb(null));
        return true;
    };

    const disconnect = (): void => {
        if (!open) {
            target.emit('error', codedError(Error, 'ERR_IPC_DISCONNECTED', 'IPC channel is already disconnected'));
            return;
        }
        close();
    };

    const handle: NodeChannelHandle = {
        fd,
        ref() {
            refed = true;
            updateHold();
        },
        unref() {
            refed = false;
            updateHold();
        },
    };

    Object.assign(target, { send, disconnect, channel: handle, connected: true });

    lines.startReading(
        (message) => {
            if (!open) return;
            if (isInternalMessage(message)) target.emit('internalMessage', message);
            else target.emit('message', message, undefined);
        },
        () => {
            reading = false;
            close();
            release();
        },
    );
    // Hold now and settle one tick later, once the caller's synchronous code has
    // had its chance to add listeners. Taking the first hold HERE is what makes
    // it stick: a GJS entry module's microtasks already run inside GJS's own
    // spin of the main context (`main_depth()` 1), where a new hold is counted
    // but no loop gets armed, and the process exits with the module.
    holding = true;
    acquireMainLoop();
    queueMicrotask(updateHold);
    return handle;
}
