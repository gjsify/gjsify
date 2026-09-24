// Teardown: what destroy() and server.close() release, and when.
// Reference: refs/node-test/parallel/test-net-socket-destroy-twice.js,
// test-net-server-close.js — 'close' means the descriptor is gone.

import { describe, it, expect, on } from '@gjsify/unit';
import type { Server, Socket } from 'node:net';
import { createServer, connect } from 'node:net';
import { Buffer } from 'node:buffer';

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

/** Resolve with the event that settles first, or 'timeout'. A hang is the bug
 *  this file pins, so it must fail as an assertion rather than stall the run. */
function firstOf(socket: Socket, events: string[], ms: number): Promise<string> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), ms);
        for (const event of events) {
            socket.once(event, () => {
                clearTimeout(timer);
                resolve(event);
            });
        }
    });
}

/**
 * A GLib log writer may be installed ONCE per process (a second
 * `g_log_set_writer_func` — `log_set_writer_default()` counts — is a fatal
 * GLib-ERROR), so it is installed lazily, forwards everything it sees to stderr
 * so nothing is hidden, and only records the warnings.
 */
let glibWarnings: string[] | null = null;
async function captureGlibWarnings(): Promise<string[]> {
    if (glibWarnings) return glibWarnings;
    type Fields = Record<string, unknown>;
    const GLib = (await import('gi://GLib?version=2.0' as string)).default as {
        log_set_writer_func(fn: (level: number, fields: Fields) => number): void;
        LogLevelFlags: { LEVEL_MASK: number; LEVEL_WARNING: number };
        LogWriterOutput: { HANDLED: number };
    };
    const seen: string[] = [];
    const decoder = new TextDecoder();
    GLib.log_set_writer_func((level, fields) => {
        try {
            const raw = fields.MESSAGE;
            const message = raw instanceof Uint8Array ? decoder.decode(raw) : String(raw ?? '');
            if ((level & GLib.LogLevelFlags.LEVEL_MASK) <= GLib.LogLevelFlags.LEVEL_WARNING) seen.push(message);
            (globalThis as unknown as { printerr(s: string): void }).printerr(message);
        } catch {
            /* a throw here is logged, which would re-enter this writer */
        }
        return GLib.LogWriterOutput.HANDLED;
    });
    glibWarnings = seen;
    return seen;
}

export default async () => {
    await describe('net teardown', async () => {
        await it('socket.destroy() closes the connection: the peer reads EOF', async () => {
            // Readable.destroy() used to skip a subclass's prototype `_destroy`, so
            // Socket._destroy never ran: destroy() emitted 'close' and kept the
            // descriptor open, and the client below waited forever for an 'end'.
            const server = createServer((socket) => {
                socket.on('error', () => {});
                socket.destroy();
            });
            const port = await listen(server);
            const client = connect(port, '127.0.0.1');
            client.on('error', () => {});
            client.resume();
            const outcome = await firstOf(client, ['end', 'close'], 2000);
            client.destroy();
            await closeServer(server);
            expect(outcome).toBe('end');
        });

        await it('a destroyed socket reports a pending write to its callback, not as an error event', async () => {
            const server = createServer((socket) => socket.resume());
            const port = await listen(server);
            const client = connect(port, '127.0.0.1');
            await new Promise<void>((resolve) => client.once('connect', () => resolve()));
            let errorEvents = 0;
            client.on('error', () => errorEvents++);
            const writeDone = new Promise<boolean>((resolve) => {
                client.write(Buffer.alloc(4 * 1024 * 1024), () => resolve(true));
            });
            client.destroy();
            await new Promise<void>((resolve) => client.once('close', () => resolve()));
            await writeDone;
            await closeServer(server);
            expect(errorEvents).toBe(0);
        });

        // refs/node/lib/net.js `Server.prototype.close` / `_emitCloseIfDrained`.
        await it('close() keeps accepted connections open; close follows the last one', async () => {
            let accepted: Socket | null = null;
            const server = createServer((socket) => {
                accepted = socket;
                socket.on('error', () => {});
            });
            const port = await listen(server);
            const client = connect(port, '127.0.0.1');
            client.on('error', () => {});
            await new Promise<void>((resolve) => server.once('connection', () => resolve()));
            let closed = false;
            server.close(() => {
                closed = true;
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(closed).toBe(false);
            expect(accepted!.destroyed).toBe(false);
            client.destroy();
            await new Promise<void>((resolve) => server.once('close', () => resolve()));
        });

        await it('close() on a server that is not listening: callback gets ERR_SERVER_NOT_RUNNING, no error event', async () => {
            const server = createServer();
            let errorEvents = 0;
            server.on('error', () => errorEvents++);
            const err = await new Promise<(Error & { code?: string }) | undefined>((resolve) => server.close(resolve));
            expect(err?.code).toBe('ERR_SERVER_NOT_RUNNING');
            expect(errorEvents).toBe(0);
        });

        await it('close() then listen() on the same port succeeds synchronously', async () => {
            // Node's close() releases the port synchronously. The listener's
            // descriptor close is deferred one main-loop iteration here (darwin
            // select(2) EBADF), so listen() must finish a pending close on its port.
            const first = createServer();
            const port = await listen(first);
            first.close();
            const second = createServer();
            const outcome = await new Promise<string>((resolve) => {
                second.once('error', (err: Error & { code?: string }) => resolve(err.code ?? err.message));
                second.listen(port, '127.0.0.1', () => resolve('listening'));
            });
            if (outcome === 'listening') await closeServer(second);
            expect(outcome).toBe('listening');
        });
    });

    await on('Gjs', async () => {
        await describe('net teardown — no GSource outlives its descriptor', async () => {
            await it('destroy() and server.close() leave nothing polling a closed fd', async () => {
                // Both used to close the descriptor while a cancelled Gio operation's
                // GSource was still attached; cancellation is only dispatched on the
                // next main-loop iteration, which then polled the closed fd. Linux's
                // poll(2) flags that entry POLLNVAL and moves on, so this is silent
                // there. GLib on darwin polls through select(2), which fails the
                // whole iteration with EBADF: "poll(2) failed due to: Bad file
                // descriptor." — once per closed server in this suite, before.
                const warnings = await captureGlibWarnings();
                const before = warnings.length;

                const server = createServer((socket) => {
                    socket.on('error', () => {});
                    socket.on('data', () => socket.destroy()); // read pending again by now
                });
                const port = await listen(server);
                const client = connect(port, '127.0.0.1');
                client.on('error', () => {});
                client.resume();
                await new Promise<void>((resolve) => client.once('connect', () => resolve()));
                client.write('x');
                await firstOf(client, ['end', 'close'], 2000);
                client.destroy(); // its own read is still pending
                await new Promise<void>((resolve) => client.once('close', () => resolve()));
                await closeServer(server);
                // Give the loop a few iterations to poll whatever is left.
                await new Promise((resolve) => setTimeout(resolve, 50));

                const badFd = warnings.slice(before).filter((m) => m.includes('Bad file descriptor'));
                expect(badFd).toStrictEqual([]);
            });
        });
    });
};
