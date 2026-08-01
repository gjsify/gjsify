// @gjsify/devtools-mcp — NativeScript CDP client transport (host side, GJS).
//
// Implements the `DevtoolsClientTransport` contract from
// `@gjsify/devtools-protocol` by talking the Chrome DevTools Protocol (CDP)
// WebSocket that NativeScript's V8 runtime serves under `ns debug android`.
//
// Discovery: the inspector exposes `http://<host>:<port>/json` — a list of
// `{ webSocketDebuggerUrl }`; we GET it (Soup) and take the first target's WS
// url unless an explicit `url` is given.
//
// Round-trip: each `DevtoolsRequest` is shipped as a single CDP
//   { id, method: 'Runtime.evaluate',
//     params: { expression: 'globalThis.__adwDevtools.dispatch(<JSON>)',
//               awaitPromise: true, returnByValue: true } }
// frame; the in-app agent (`@gjsify/devtools-nativescript`) runs the registry
// and returns a JSON-encoded `DevtoolsResponse` STRING, which arrives as
// `result.result.value` and is JSON-parsed back into a `DevtoolsResponse`.
//
// Runs on GJS (Soup + GLib). Original implementation.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';
import type { DevtoolsRequest, DevtoolsResponse } from '@gjsify/devtools-protocol';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Soup.Session.prototype, 'websocket_connect_async', 'websocket_connect_finish');

/** Connection target — an explicit ws url, or an inspector host:port to discover from. */
export interface NsCdpConnectOptions {
    /** Explicit `ws://…` CDP debugger url; skips HTTP discovery when set. */
    url?: string;
    /** Inspector host for `/json` discovery. Default `127.0.0.1`. */
    host?: string;
    /** Inspector port for `/json` discovery. Default `9222` (NS V8 `--debug-brk`/`ns debug`). */
    port?: number;
}

/** One entry of the inspector's `/json` target list (only the field we use). */
interface CdpTarget {
    webSocketDebuggerUrl?: string;
}

/** A pending CDP request awaiting its matching `{ id, result | error }` frame. */
interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

/**
 * Host-side transport that dials a running NativeScript app's in-app devtools
 * agent (`globalThis.__adwDevtools`) over the V8 inspector CDP socket. The MCP
 * bridge talks the SAME `@gjsify/devtools-protocol` contract over it as it does
 * over DBus for GTK apps, so the generic tools are identical across runtimes.
 */
export class NsCdpClient {
    private readonly _session = new Soup.Session();
    private _connection: Soup.WebsocketConnection | null = null;
    private _nextId = 1;
    private readonly _pending = new Map<number, Pending>();
    private readonly _host: string;
    private readonly _port: number;
    private readonly _explicitUrl: string | undefined;
    private readonly _decoder = new TextDecoder();
    private readonly _encoder = new TextEncoder();

    constructor(options: NsCdpConnectOptions = {}) {
        this._host = options.host ?? '127.0.0.1';
        this._port = options.port ?? 9222;
        this._explicitUrl = options.url;
    }

    /** Open the CDP WebSocket (discovering the debugger url first if needed). */
    async connect(): Promise<void> {
        if (this._connection) return;
        const wsUrl = this._explicitUrl ?? (await this._discoverDebuggerUrl());
        const uri = GLib.Uri.parse(wsUrl, GLib.UriFlags.NONE);
        const msg = new Soup.Message({ method: 'GET', uri });
        const conn = (await this._session.websocket_connect_async(
            msg,
            null,
            null,
            GLib.PRIORITY_DEFAULT,
            null,
        )) as Soup.WebsocketConnection;
        conn.max_incoming_payload_size = 100 * 1024 * 1024;
        conn.connect('message', (_c: Soup.WebsocketConnection, type: number, message: GLib.Bytes) => {
            if (type === Soup.WebsocketDataType.TEXT) this._onMessage(this._decoder.decode(message.toArray()));
        });
        conn.connect('closed', () => this._onClosed());
        this._connection = conn;
        // Enable the Runtime domain so `Runtime.evaluate` is accepted.
        await this._call('Runtime.enable', {});
    }

    /**
     * Send a {@link DevtoolsRequest} to the in-app agent and resolve with its
     * {@link DevtoolsResponse}. The agent's `dispatch` is invoked over CDP
     * `Runtime.evaluate` and its JSON-string return is parsed back.
     */
    async request(req: DevtoolsRequest): Promise<DevtoolsResponse> {
        const reqJson = JSON.stringify(req);
        const expression = `globalThis.__adwDevtools.dispatch(${JSON.stringify(reqJson)})`;
        const result = (await this._call('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        })) as { result?: { value?: unknown; type?: string }; exceptionDetails?: { text?: string } };

        if (result.exceptionDetails) {
            throw new Error(`CDP Runtime.evaluate threw: ${result.exceptionDetails.text ?? 'unknown error'}`);
        }
        const value = result.result?.value;
        if (typeof value !== 'string') {
            throw new Error(
                'NativeScript devtools agent returned no response — is installDevtools() called with GJSIFY_DEVTOOLS=1?',
            );
        }
        return JSON.parse(value) as DevtoolsResponse;
    }

    /** Close the CDP socket and reject any in-flight requests. */
    async close(): Promise<void> {
        if (this._connection) {
            this._connection.close(Soup.WebsocketCloseCode.NORMAL, null);
            this._connection = null;
        }
        for (const pending of this._pending.values()) {
            pending.reject(new Error('CDP connection closed'));
        }
        this._pending.clear();
    }

    // --- internals ---

    /** GET `http://host:port/json` and return the first target's debugger url. */
    private async _discoverDebuggerUrl(): Promise<string> {
        const jsonUrl = `http://${this._host}:${this._port}/json`;
        const msg = new Soup.Message({ method: 'GET', uri: GLib.Uri.parse(jsonUrl, GLib.UriFlags.NONE) });
        let bytes: GLib.Bytes;
        try {
            bytes = (await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null)) as GLib.Bytes;
        } catch (error) {
            throw new Error(
                `Cannot reach the NativeScript inspector at ${jsonUrl} — run \`ns debug android\` (or forward the ` +
                    `port with \`adb forward tcp:${this._port} …\`). (${error instanceof Error ? error.message : String(error)})`,
            );
        }
        const status = msg.get_status();
        if (status !== Soup.Status.OK) {
            throw new Error(`Inspector discovery failed: ${jsonUrl} returned HTTP ${status}`);
        }
        const text = this._decoder.decode(bytes.toArray());
        let targets: CdpTarget[];
        try {
            targets = JSON.parse(text) as CdpTarget[];
        } catch {
            throw new Error(`Inspector discovery returned non-JSON from ${jsonUrl}`);
        }
        const wsUrl = targets.find((t) => typeof t.webSocketDebuggerUrl === 'string')?.webSocketDebuggerUrl;
        if (!wsUrl) {
            throw new Error(`No webSocketDebuggerUrl in the inspector target list at ${jsonUrl}`);
        }
        return wsUrl;
    }

    /** Issue a raw CDP method call and resolve with its `result` object. */
    private _call(method: string, params: Record<string, unknown>): Promise<unknown> {
        if (!this._connection) return Promise.reject(new Error('CDP connection not open'));
        const id = this._nextId++;
        const frame = JSON.stringify({ id, method, params });
        return new Promise<unknown>((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this._connection?.send_message(Soup.WebsocketDataType.TEXT, new GLib.Bytes(this._encoder.encode(frame)));
        });
    }

    private _onMessage(text: string): void {
        let frame: { id?: number; result?: unknown; error?: { message?: string; code?: number } };
        try {
            frame = JSON.parse(text);
        } catch {
            return; // ignore non-JSON / event frames we don't model
        }
        if (typeof frame.id !== 'number') return; // a CDP event, not a command reply
        const pending = this._pending.get(frame.id);
        if (!pending) return;
        this._pending.delete(frame.id);
        if (frame.error) {
            pending.reject(
                new Error(`CDP error ${frame.error.code ?? ''}: ${frame.error.message ?? 'unknown'}`.trim()),
            );
        } else {
            pending.resolve(frame.result);
        }
    }

    private _onClosed(): void {
        this._connection = null;
        for (const pending of this._pending.values()) {
            pending.reject(new Error('CDP connection closed by the device'));
        }
        this._pending.clear();
    }
}
