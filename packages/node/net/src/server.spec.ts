// TCP server/client integration tests — connection lifecycle, data transfer, error handling
// Reference: refs/node-test/parallel/test-net-*.js

import { describe, it, expect } from '@gjsify/unit';
import type { Server, Socket } from 'node:net';
import { createServer, createConnection } from 'node:net';
import { Buffer } from 'node:buffer';

import { isPeerReset } from './error.spec.js';

/**
 * Attach the `'error'` listener a client or server socket needs to survive a
 * peer that resets instead of closing cleanly.
 *
 * BSD and Linux differ here, and the difference is the kernel's, not ours:
 * closing a socket that still holds unread inbound data sends an RST on macOS
 * where Linux delivers a FIN. An `'error'` event with no listener is RE-THROWN
 * by Node, so several specs below — whose subject is `close`, `end`,
 * `localPort` or the bytes transferred, never the shutdown mechanics — failed
 * on darwin under NATIVE Node while passing under GJS on the same host. Per
 * this repo's testing rules that makes it a statement about the TEST.
 *
 * Only a reset is tolerated. Anything else is re-thrown, so this cannot grow
 * into a blanket "ignore socket errors".
 *
 * EVERY client socket in this file now registers one of these, and that is a
 * rule rather than a habit. A spec resolves as soon as it has its answer and
 * `withServer` then destroys the accepted socket, so the client can see the RST
 * AFTER its own spec finished — and an unhandled `error` event is attributed to
 * whichever spec is running by then. Measured on the macOS arm64 leg:
 * `read ECONNRESET` reported against `should expose localPort after connect`,
 * which already HAD tolerance; the socket that reset belonged to the previous
 * spec, which did not.
 *
 * So the only choice per socket is which tolerance: `tolerateReset` where the
 * spec has no error path of its own, `rejectUnlessReset(reject)` where it does.
 * A bare `client.on('error', reject)` is the shape that fails, because it turns
 * teardown noise into the spec's verdict. The one deliberate exception is the
 * connection-refused spec, whose subject IS the error.
 *
 * The two differ ONLY in where a non-reset goes, so both ask `isPeerReset` rather
 * than each spelling `err.code !== 'ECONNRESET'`: the rule — which codes count as a
 * peer reset, and why `EPIPE` and `ERR_STREAM_*` do not — is stated once in
 * `error.spec.ts` and pinned there over four codes, and a second copy of the
 * comparison here would be a second rule that could drift from it unseen.
 */
function tolerateReset(socket: { on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown }): void {
    socket.on('error', (err) => {
        if (!isPeerReset(err)) throw err;
    });
}

/** `reject`, but a peer RST is teardown noise rather than a failure — see {@link tolerateReset}. */
function rejectUnlessReset(reject: (err: unknown) => void): (err: NodeJS.ErrnoException) => void {
    return (err) => {
        if (!isPeerReset(err)) reject(err);
    };
}

/**
 * Close a socket the way BSD rewards: consume what is buffered, THEN close.
 *
 * Which of the two the peer sees is decided by the RECEIVE queue at close
 * time, not by how the close was asked for. A `destroy()` on a socket that
 * never read its peer's FIN answers a clean shutdown with an RST, and the peer
 * reports `read ECONNRESET`; drain first and the kernel sends the FIN. Linux
 * delivers the FIN either way, which is why only the darwin leg ever saw this.
 */
function drainAndClose(sockets: readonly Socket[]): void {
    for (const socket of sockets) {
        socket.resume();
        socket.destroy();
    }
}

/**
 * The CLIENT sockets of ONE spec, owned the way `withServer` owns the accepted
 * ones — so that no socket outlives the spec that made it.
 *
 * This is a scope and not a helper call, because the lifetime it owns is the
 * spec's. A spec resolves as soon as it has its answer; a socket it did not
 * close therefore keeps emitting afterwards, and Node attributes an unhandled
 * `'error'` to whichever spec is running by then. That is what made the darwin
 * failures WANDER — `close event after end` one run, `localPort after connect`
 * the next — rather than sit on the spec that caused them. The rate is far below
 * what a single run can see: 214 consecutive `test:node` runs on darwin/arm64
 * measured clean and the macOS CI leg is green at the same commit, which is a
 * reason to fix the ownership rather than to keep watching for the symptom.
 *
 * `connect` also owns the error listener, which is why the narrow floor cannot
 * be forgotten and a blanket one cannot be asked for: omit `onError` and the
 * scope registers {@link tolerateReset}, which re-throws everything but a
 * reset; pass one and that is the ONLY listener the socket gets, so a spec with
 * a real error path is never also handed the re-throwing one.
 */
interface ClientScope {
    connect(
        options: { port: number; host: string },
        onConnect?: () => void,
        onError?: (err: NodeJS.ErrnoException) => void,
    ): Socket;
    /** Take a socket created elsewhere into the same teardown. */
    adopt<T extends Socket>(socket: T): T;
}

/** Run `body` owning every client socket it makes, for its duration only. */
function withClientScope<T>(body: (clients: ClientScope) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const { scope, close } = clientScope();
        body(scope).then(
            (value) => {
                close();
                resolve(value);
            },
            (err) => {
                close();
                reject(err);
            },
        );
    });
}

/** The scope plus the teardown that owns it — split so `withServer` can order its own teardown around it. */
function clientScope(): { scope: ClientScope; close: () => void } {
    const owned: Socket[] = [];
    return {
        scope: {
            connect(options, onConnect, onError) {
                const socket = createConnection(options, onConnect);
                owned.push(socket);
                if (onError) socket.on('error', onError);
                else tolerateReset(socket);
                return socket;
            },
            adopt(socket) {
                owned.push(socket);
                return socket;
            },
        },
        close: () => drainAndClose(owned),
    };
}

/**
 * Helper: create server, run test, cleanup.
 *
 * Cleanup lives beside creation, and it covers the CLIENT and ACCEPTED sockets
 * and not just the listener. `server.close()` alone stops new connections and
 * leaves established ones open, so a socket from a finished spec could still
 * emit later and the harness would attribute it to whichever spec was running.
 *
 * The order is load-bearing: the clients go first, so the RST that closing the
 * accepted sockets provokes lands on handles that are already gone instead of on
 * a live client whose spec has already resolved.
 */
function withServer(handler: (server: Server, port: number, clients: ClientScope) => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
        const { scope: clients, close: closeClients } = clientScope();
        const server = createServer();
        const accepted: Socket[] = [];
        server.on('connection', (socket) => {
            // No spec here has "the server end does not get reset" as its
            // subject, so tolerance is registered once, before any spec's own
            // handler, rather than per spec.
            tolerateReset(socket);
            accepted.push(socket);
        });
        const cleanup = (): void => {
            closeClients();
            drainAndClose(accepted);
            server.close();
        };
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            handler(server, addr.port, clients).then(
                () => {
                    cleanup();
                    resolve();
                },
                (err) => {
                    cleanup();
                    reject(err);
                },
            );
        });
    });
}

export default async () => {
    await describe('net TCP: echo server', async () => {
        await it('should echo data back to client', async () => {
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => {
                    socket.on('data', (data) => socket.write(data));
                });
                const result = await new Promise<string>((resolve, reject) => {
                    const client = clients.connect({ port, host: '127.0.0.1' }, () => {
                        client.write('hello echo');
                    });
                    client.setEncoding('utf8');
                    client.on('data', (data: string | Buffer) => {
                        client.end();
                        resolve(typeof data === 'string' ? data : data.toString('utf8'));
                    });
                    client.on('error', rejectUnlessReset(reject));
                });
                expect(result).toBe('hello echo');
            });
        });

        await it('should echo a second message after first completes', async () => {
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => {
                    socket.on('data', (data) => socket.write(data));
                });
                // Send one message, wait for echo, then send another
                const result = await new Promise<string>((resolve, reject) => {
                    const client = clients.connect({ port, host: '127.0.0.1' }, () => {
                        client.write('first');
                    });
                    client.setEncoding('utf8');
                    let received = '';
                    client.on('data', (data) => {
                        received += data;
                        if (received === 'first') {
                            // Send second message after first echo completes
                            client.write('second');
                        } else if (received.includes('second')) {
                            client.end();
                            resolve(received);
                        }
                    });
                    client.on('error', rejectUnlessReset(reject));
                });
                expect(result).toBe('firstsecond');
            });
        });
    });

    await describe('net TCP: large data transfer', async () => {
        await it('should transfer 64KB of data', async () => {
            const size = 64 * 1024;
            const data = Buffer.alloc(size, 0x41); // 'A'
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => {
                    socket.write(data);
                    socket.end();
                });
                const received = await new Promise<Buffer>((resolve, reject) => {
                    const chunks: Buffer[] = [];
                    const client = clients.connect({ port, host: '127.0.0.1' });
                    client.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                    client.on('end', () => resolve(Buffer.concat(chunks)));
                    client.on('error', rejectUnlessReset(reject));
                });
                expect(received.length).toBe(size);
            });
        });
    });

    await describe('net TCP: connection events', async () => {
        await it('should emit connect event on client', async () => {
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => socket.end());
                const connected = await new Promise<boolean>((resolve) => {
                    const client = clients.connect({ port, host: '127.0.0.1' });
                    client.on('connect', () => {
                        client.end();
                        resolve(true);
                    });
                });
                expect(connected).toBe(true);
            });
        });

        await it('should emit close event after end', async () => {
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => socket.end('bye'));
                const closed = await new Promise<boolean>((resolve) => {
                    const client = clients.connect({ port, host: '127.0.0.1' });
                    client.on('close', () => resolve(true));
                    client.resume(); // Consume data to allow close
                });
                expect(closed).toBe(true);
            });
        });

        await it('should emit end event when server closes', async () => {
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => socket.end());
                const ended = await new Promise<boolean>((resolve) => {
                    const client = clients.connect({ port, host: '127.0.0.1' });
                    client.on('end', () => {
                        client.end();
                        resolve(true);
                    });
                });
                expect(ended).toBe(true);
            });
        });

        await it('should track connection count via server event', async () => {
            let connectionCount = 0;
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => {
                    connectionCount++;
                    socket.end();
                });
                for (let i = 0; i < 3; i++) {
                    await new Promise<void>((resolve) => {
                        const client = clients.connect({ port, host: '127.0.0.1' });
                        client.on('close', () => resolve());
                        client.resume();
                    });
                }
            });
            expect(connectionCount).toBe(3);
        });
    });

    await describe('net TCP: server properties', async () => {
        await it('should return address with port and family', async () => {
            await withServer(async (server, port) => {
                const addr = server.address() as { port: number; family: string; address: string };
                expect(addr.port).toBe(port);
                expect(addr.port).toBeGreaterThan(0);
                expect(typeof addr.address).toBe('string');
            });
        });

        await it('should set listening to true after listen', async () => {
            await withServer(async (server) => {
                expect(server.listening).toBe(true);
            });
        });

        await it('should allocate random port when 0 specified', async () => {
            const server = createServer();
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
            const addr = server.address() as { port: number };
            expect(addr.port).toBeGreaterThan(0);
            expect(addr.port).toBeLessThan(65536);
            await new Promise<void>((resolve) => server.close(() => resolve()));
        });
    });

    await describe('net TCP: socket properties', async () => {
        await it('should expose remoteAddress and remotePort after connect', async () => {
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => socket.end());
                const { remoteAddress, remotePort } = await new Promise<{ remoteAddress: string; remotePort: number }>(
                    (resolve) => {
                        const client = clients.connect({ port, host: '127.0.0.1' }, () => {
                            resolve({
                                remoteAddress: client.remoteAddress!,
                                remotePort: client.remotePort!,
                            });
                            client.end();
                        });
                    },
                );
                expect(remoteAddress).toBe('127.0.0.1');
                expect(remotePort).toBe(port);
            });
        });

        await it('should expose localPort after connect', async () => {
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => socket.end());
                const localPort = await new Promise<number>((resolve) => {
                    const client = clients.connect({ port, host: '127.0.0.1' }, () => {
                        resolve(client.localPort!);
                        client.end();
                    });
                });
                expect(localPort).toBeGreaterThan(0);
            });
        });
    });

    await describe('net TCP: data encoding', async () => {
        await it('should transfer UTF-8 strings', async () => {
            const testStr = 'Hallo Welt! 你好世界';
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => {
                    socket.write(testStr, 'utf8');
                    socket.end();
                });
                const received = await new Promise<string>((resolve, reject) => {
                    const chunks: string[] = [];
                    const client = clients.connect({ port, host: '127.0.0.1' });
                    client.setEncoding('utf8');
                    client.on('data', (data: string | Buffer) =>
                        chunks.push(typeof data === 'string' ? data : data.toString('utf8')),
                    );
                    client.on('end', () => resolve(chunks.join('')));
                    client.on('error', rejectUnlessReset(reject));
                });
                expect(received).toBe(testStr);
            });
        });

        await it('should transfer binary data', async () => {
            const binary = Buffer.from([0x00, 0x01, 0x80, 0xff, 0xfe]);
            await withServer(async (server, port, clients) => {
                server.on('connection', (socket) => {
                    socket.write(binary);
                    socket.end();
                });
                const received = await new Promise<Buffer>((resolve, reject) => {
                    const chunks: Buffer[] = [];
                    const client = clients.connect({ port, host: '127.0.0.1' });
                    client.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                    client.on('end', () => resolve(Buffer.concat(chunks)));
                    client.on('error', rejectUnlessReset(reject));
                });
                expect(received.length).toBe(5);
                expect(received[0]).toBe(0x00);
                expect(received[2]).toBe(0x80);
                expect(received[4]).toBe(0xfe);
            });
        });
    });

    await describe('net TCP: error handling', async () => {
        await it('should emit error for connection refused', async () => {
            const err = await withClientScope(async (clients) => {
                return new Promise<Error>((resolve) => {
                    // Port 1 is almost certainly not listening. The error IS this
                    // spec's subject, so this is the one socket that brings its
                    // own listener instead of taking the reset floor.
                    clients.connect({ port: 1, host: '127.0.0.1' }, undefined, (e) => resolve(e));
                });
            });
            expect(err).toBeDefined();
            expect((err as NodeJS.ErrnoException).code).toBeDefined();
        });

        await it('should handle server close while client connected', async () => {
            await withClientScope(async (clients) => {
                // The server end is owned here too. This spec drives
                // `server.close()` itself, but the ACCEPTED socket it left
                // behind outlived the spec and carried no error listener — the
                // one socket in this file an unhandled reset could still land on.
                let accepted = 0;
                const server = createServer((socket) => {
                    clients.adopt(socket);
                    accepted++;
                    // Close server immediately
                    server.close();
                    socket.end('goodbye');
                });
                await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
                const port = (server.address() as { port: number }).port;

                const data = await new Promise<string>((resolve) => {
                    const client = clients.connect({ port, host: '127.0.0.1' });
                    client.setEncoding('utf8');
                    const chunks: string[] = [];
                    client.on('data', (chunk: string | Buffer) =>
                        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8')),
                    );
                    client.on('end', () => resolve(chunks.join('')));
                });
                expect(data).toBe('goodbye');
                expect(accepted).toBe(1);
            });
        });
    });
};
