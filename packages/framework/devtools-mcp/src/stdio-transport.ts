// @gjsify/devtools-mcp — MCP stdio transport on GJS Gio streams (fd 0 / fd 1).
// Adapted from the PixelRPG map-editor (apps/mcp-bridge/src/stdio-transport.ts).
// Copyright (c) PixelRPG. MIT.

import Gio from '@girs/gio-2.0';
import GioUnix from '@girs/giounix-2.0';
import GLib from '@girs/glib-2.0';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// GJS does not auto-promisify here; opt the reader in once at module load.
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish');

/**
 * MCP stdio transport implemented on GJS Gio streams. The SDK's bundled
 * `StdioServerTransport` reads Node's `process.stdin`, which gjsify does not
 * deliver piped data on — so we read newline-delimited JSON-RPC straight off
 * fd 0 with a `Gio.DataInputStream` and write replies to fd 1. Drive it from
 * a `GLib.MainLoop` (see {@link runDevtoolsMcp}) so the async read loop is
 * pumped.
 */
export class GjsStdioTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    sessionId?: string;

    private _in: Gio.DataInputStream | null = null;
    private _out: Gio.OutputStream | null = null;
    private readonly _cancellable = new Gio.Cancellable();
    private _closed = false;
    private readonly _encoder = new TextEncoder();
    private readonly _decoder = new TextDecoder();

    /**
     * @param onExit called when stdin reaches EOF or the transport closes.
     *   Separate from {@link onclose} because the MCP `Server` overwrites
     *   `onclose` during `connect()`; the owner uses this to quit its loop.
     */
    constructor(private readonly onExit?: () => void) {}

    async start(): Promise<void> {
        if (this._in) throw new Error('GjsStdioTransport already started');
        // GioUnix.InputStream extends Gio.InputStream but @girs types them as
        // nominally distinct across packages — cast to the base stream type.
        const stdin = GioUnix.InputStream.new(0, false) as unknown as Gio.InputStream;
        this._in = new Gio.DataInputStream({ base_stream: stdin });
        this._out = GioUnix.OutputStream.new(1, false);
        void this._readLoop();
    }

    private async _readLoop(): Promise<void> {
        while (!this._closed && this._in) {
            let line: Uint8Array | null;
            try {
                [line] = await this._in.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable);
            } catch (error) {
                if (!this._closed) this.onerror?.(error instanceof Error ? error : new Error(String(error)));
                break;
            }
            if (line === null) break; // EOF — the client closed stdin
            const text = this._decoder.decode(line).trim();
            if (!text) continue;
            try {
                this.onmessage?.(JSON.parse(text) as JSONRPCMessage);
            } catch (error) {
                this.onerror?.(error instanceof Error ? error : new Error(String(error)));
            }
        }
        if (!this._closed) {
            this._closed = true;
            this.onclose?.();
        }
        this.onExit?.();
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (!this._out) throw new Error('GjsStdioTransport not started');
        this._out.write_all(this._encoder.encode(`${JSON.stringify(message)}\n`), null);
    }

    async close(): Promise<void> {
        if (this._closed) return;
        this._closed = true;
        this._cancellable.cancel();
        this.onclose?.();
        this.onExit?.();
    }
}
