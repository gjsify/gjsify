// Reference: Node.js lib/net.js
// Reimplemented for GJS using Gio.SocketService

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { createNodeError, deferEmit, ensureMainLoop } from '@gjsify/utils/core';
import type { ErrnoException } from '@gjsify/utils/core';
import { Socket } from './socket.js';

export interface ListenOptions {
    port?: number;
    host?: string;
    backlog?: number;
    exclusive?: boolean;
}

// GC guard — GJS garbage-collects objects with no JS references.
// Keep strong references to all listening servers to prevent their
// Gio.SocketService from being collected while still active.
const _activeServers = new Set<Server>();

export class Server extends EventEmitter {
    listening = false;
    maxConnections?: number;
    allowHalfOpen: boolean;

    private _service: Gio.SocketService | null = null;
    private _connections = new Set<Socket>();
    private _listenerClosed = false;
    private _address: { port: number; family: string; address: string } | null = null;

    constructor(connectionListener?: (socket: Socket) => void);
    constructor(options?: { allowHalfOpen?: boolean }, connectionListener?: (socket: Socket) => void);
    constructor(
        optionsOrListener?: { allowHalfOpen?: boolean } | ((socket: Socket) => void),
        connectionListener?: (socket: Socket) => void,
    ) {
        super();

        if (typeof optionsOrListener === 'function') {
            connectionListener = optionsOrListener;
            this.allowHalfOpen = false;
        } else {
            this.allowHalfOpen = optionsOrListener?.allowHalfOpen ?? false;
        }

        if (connectionListener) {
            this.on('connection', connectionListener);
        }
    }

    /**
     * Start listening for connections.
     */
    listen(port?: number, host?: string, backlog?: number, callback?: () => void): this;
    listen(port?: number, host?: string, callback?: () => void): this;
    listen(port?: number, callback?: () => void): this;
    listen(options?: ListenOptions, callback?: () => void): this;
    listen(...args: unknown[]): this {
        let port = 0;
        let host = '0.0.0.0';
        let backlog = 511;
        let callback: (() => void) | undefined;

        // Parse overloaded arguments
        if (typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
            const opts = args[0] as ListenOptions;
            port = opts.port ?? 0;
            host = opts.host ?? '0.0.0.0';
            backlog = opts.backlog ?? 511;
            callback = args[1] as (() => void) | undefined;
        } else {
            if (typeof args[0] === 'number') port = args[0];
            for (let i = 1; i < args.length; i++) {
                if (typeof args[i] === 'string') host = args[i] as string;
                else if (typeof args[i] === 'number') backlog = args[i] as number;
                else if (typeof args[i] === 'function') callback = args[i] as () => void;
            }
        }

        if (callback) {
            this.once('listening', callback);
        }

        try {
            this._service = new Gio.SocketService();
            this._service.set_backlog(backlog);

            let actualPort: number;
            if (port === 0) {
                actualPort = this._service.add_any_inet_port(null);
            } else {
                this._service.add_inet_port(port, null);
                actualPort = port;
            }

            // Connect the incoming signal
            this._service.connect('incoming', (_service: Gio.SocketService, connection: Gio.SocketConnection) => {
                this._handleConnection(connection);
                return true;
            });

            this._service.start();
            ensureMainLoop();
            this.listening = true;
            _activeServers.add(this);

            // Determine address info
            const family = host.includes(':') ? 'IPv6' : 'IPv4';
            this._address = { port: actualPort, family, address: host };

            // Emit listening asynchronously (matching Node.js behavior)
            deferEmit(this, 'listening');
        } catch (err: unknown) {
            const nodeErr = createNodeError(err, 'listen', { address: host, port });
            deferEmit(this, 'error', nodeErr);
        }

        return this;
    }

    private _handleConnection(connection: Gio.SocketConnection): void {
        if (this.maxConnections && this._connections.size >= this.maxConnections) {
            try {
                connection.close(null);
            } catch {
                /* ignore */
            }
            return;
        }

        // Create a Socket wrapping this connection
        const socket = new Socket({ allowHalfOpen: this.allowHalfOpen });

        // Inject the connection directly (bypass connect())
        socket._setConnection(connection);
        socket._setupConnection({});

        this._connections.add(socket);
        socket.on('close', () => {
            this._connections.delete(socket);
            this._maybeEmitClose();
        });

        this.emit('connection', socket);
    }

    /** Get the address the server is listening on. */
    address(): { port: number; family: string; address: string } | null {
        return this._address;
    }

    /** Close the server, stop accepting new connections. */
    close(callback?: (err?: Error) => void): this {
        if (callback) {
            this.once('close', callback);
        }

        if (!this._service || !this.listening) {
            setTimeout(() => {
                const err = new Error('Server is not running') as ErrnoException;
                err.code = 'ERR_SERVER_NOT_RUNNING';
                this.emit('error', err);
            }, 0);
            return this;
        }

        const service = this._service;
        this._service = null;
        this.listening = false;

        // Node's contract: close() stops ACCEPTING; connections already accepted
        // stay open, and 'close' is emitted once the last of them has closed.
        //
        // stop() only CANCELS the pending accept; its GSource keeps polling the
        // listening descriptor until the cancellation is dispatched on the next
        // main-loop iteration. Closing the listener synchronously here left that
        // source on a closed fd: harmless on Linux (poll(2) reports POLLNVAL for
        // the one entry), but GLib on darwin polls via select(2), which fails the
        // whole iteration with EBADF and warns "poll(2) failed due to: Bad file
        // descriptor". So the listener is closed from a 0 ms source at the SAME
        // priority as the accept's: GLib dispatches a priority band in attach
        // order, and the accept source was attached first (at listen, or when the
        // service re-armed after the last accept) — by the time this runs, the
        // cancellation has been dispatched and the source destroyed. Not an idle:
        // a lower-priority source is starved for as long as anything at DEFAULT
        // stays ready (GJS's own promise-drain source does, under a busy chain).
        service.stop();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            service.close();
            this._listenerClosed = true;
            this._maybeEmitClose();
            return GLib.SOURCE_REMOVE;
        });
        return this;
    }

    /** 'close' follows the real close of the listener AND of every connection. */
    private _maybeEmitClose(): void {
        if (!this._listenerClosed || this._connections.size > 0) return;
        this._listenerClosed = false;
        _activeServers.delete(this);
        this.emit('close');
    }

    /** Get the number of concurrent connections. */
    getConnections(callback: (err: Error | null, count: number) => void): void {
        callback(null, this._connections.size);
    }

    ref(): this {
        return this;
    }
    unref(): this {
        return this;
    }
}
