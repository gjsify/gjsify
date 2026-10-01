// @gjsify/mcp — stdio serve loop that ends when the client goes away.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Readable, Writable } from 'node:stream';

export interface ServeOptions {
    /** Prefix of the stderr line printed on disconnect. Default `mcp`. */
    label?: string;
    /** Input stream. Default `process.stdin`. */
    stdin?: Readable;
    /** Output stream. Default `process.stdout`. */
    stdout?: Writable;
}

/**
 * Serve over stdio until the client goes away, then resolve (the process is left alone — see
 * {@link serveStdio} for the variant that exits).
 *
 * Park until EOF — NOT forever. `await new Promise<never>(() => {})` is unsettleable, so a server
 * whose client died keeps running; such processes have been found REPARENTED TO `systemd --user`,
 * which only happens once the spawning process is gone. stdin EOF is the signal: for a stdio
 * child, the parent closing the pipe IS "you are done". The MCP SDK will not report it — its
 * `StdioServerTransport` attaches only `data` and `error` to stdin and calls `close()` solely on
 * explicit shutdown, so EOF is left to the server author.
 *
 * Several concurrently running servers are NOT leaks: each editor session legitimately owns one.
 * The liveness test is a live client ancestor, not membership in the session doing the counting.
 */
export async function serveUntilClosed(server: McpServer, options: ServeOptions = {}): Promise<void> {
    const stdin: Readable = options.stdin ?? process.stdin;
    const transport = new StdioServerTransport(stdin, options.stdout ?? process.stdout);
    await server.connect(transport);
    // @gjsify/process (0.11+) auto-resumes the stdin stream when the SDK attaches its `data`
    // listener, exactly like Node — no manual `process.stdin.resume()` is needed.
    await new Promise<void>((resolve) => {
        // CHAIN, never clobber: `server.connect()` already installed the Protocol's own `onclose`
        // for its bookkeeping; overwriting it would silently disable the SDK's cleanup.
        const sdkOnClose = transport.onclose;
        transport.onclose = () => {
            sdkOnClose?.();
            resolve();
        };
        stdin.once('end', resolve);
        stdin.once('close', resolve);
    });
    console.error(`[${options.label ?? 'mcp'}] client disconnected (stdin closed) — exiting`);
}

/**
 * {@link serveUntilClosed}, then `process.exit(0)`.
 *
 * The explicit exit is needed because returning is not enough: the GLib main loop a gjsify CLI arms
 * keeps the process parked at 0 % CPU with nothing left to serve, and only `process.exit()` tears
 * it down. `return` in front is the house rule — a bare `process.exit()` under GJS schedules the
 * exit and keeps running, which double-exits.
 */
export async function serveStdio(server: McpServer, label = 'mcp'): Promise<never> {
    await serveUntilClosed(server, { label });
    return process.exit(0);
}
