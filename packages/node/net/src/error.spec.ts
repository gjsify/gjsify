// Net error handling and lifecycle tests
// Ported from refs/node-test/parallel/test-net-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as net from 'node:net';

/**
 * Is this socket error the peer aborting the connection rather than a real fault?
 *
 * Closing a TCP connection that still has unread data queued in the peer's receive
 * buffer makes the stack send RST instead of FIN, and the sender's next read reports
 * `ECONNRESET`. Whether that surfaces depends on the OS, which is why it needs naming
 * rather than blanket tolerance: win32 delivers the reset to a server socket whose
 * client simply walked away, darwin and linux deliver a clean FIN and the read reports
 * EOF. `read ECONNRESET` is that event, not a bug — a spec that has no reader for the
 * peer's data provokes it.
 *
 * Deliberately narrow: `EPIPE` is OUR write to a socket the peer already closed, and a
 * `ERR_STREAM_*` code comes from the stream layer above the socket, so neither is a peer
 * reset and a test that swallows one of those is hiding something real.
 */
export function isPeerReset(err: unknown): boolean {
    return (err as { code?: string } | null | undefined)?.code === 'ECONNRESET';
}

export default async () => {
    await describe('net.Socket destroy', async () => {
        await it('should be safe to call destroy() multiple times', async () => {
            const socket = new net.Socket();
            socket.destroy();
            socket.destroy();
            socket.destroy();
            expect(socket.destroyed).toBe(true);
        });

        await it('should emit close after destroy', async () => {
            await new Promise<void>((resolve) => {
                const socket = new net.Socket();
                socket.on('close', () => {
                    expect(socket.destroyed).toBe(true);
                    resolve();
                });
                socket.destroy();
            });
        });

        await it('should emit error event when destroyed with error', async () => {
            await new Promise<void>((resolve) => {
                const socket = new net.Socket();
                let errorEmitted = false;
                socket.on('error', (err: Error) => {
                    errorEmitted = true;
                    expect(err.message).toBe('test');
                });
                socket.on('close', () => {
                    expect(errorEmitted).toBe(true);
                    resolve();
                });
                socket.destroy(new Error('test'));
            });
        });
    });

    await describe('net.Server.getConnections', async () => {
        await it('should return 0 when no connections', async () => {
            const server = net.createServer();
            await new Promise<void>((resolve, reject) => {
                server.listen(0, () => {
                    server.getConnections((err, count) => {
                        expect(err).toBeNull();
                        expect(count).toBe(0);
                        server.close(() => resolve());
                    });
                });
                server.on('error', reject);
            });
        });

        await it('should count active connections', async () => {
            const server = net.createServer();
            await new Promise<void>((resolve, reject) => {
                server.listen(0, () => {
                    const addr = server.address() as { port: number };
                    const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
                        // Give server time to accept the connection
                        setTimeout(() => {
                            server.getConnections((err, count) => {
                                expect(err).toBeNull();
                                expect(count).toBe(1);
                                client.destroy();
                                server.close(() => resolve());
                            });
                        }, 50);
                    });
                    client.on('error', reject);
                });
                server.on('error', reject);
            });
        });
    });

    await describe('net.Server.maxConnections', async () => {
        await it('should accept maxConnections property', async () => {
            const server = net.createServer();
            server.maxConnections = 5;
            expect(server.maxConnections).toBe(5);
            server.close();
        });
    });

    // Connection refused is already tested in index.spec.ts and server.spec.ts

    await describe('net.Socket address info', async () => {
        await it('should have correct address info after connect', async () => {
            const server = net.createServer();
            await new Promise<void>((resolve, reject) => {
                server.listen(0, () => {
                    const addr = server.address() as { port: number };
                    const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
                        expect(client.remoteAddress).toBe('127.0.0.1');
                        expect(client.remotePort).toBe(addr.port);
                        expect(client.localAddress).toBeDefined();
                        expect(client.localPort).toBeDefined();
                        expect(typeof client.localPort).toBe('number');
                        client.destroy();
                        server.close(() => resolve());
                    });
                    client.on('error', reject);
                });
                server.on('error', reject);
            });
        });
    });

    await describe('net.Server close edge cases', async () => {
        await it('should handle closing a non-listening server', async () => {
            const server = net.createServer();
            let errorOrClose = false;
            server.on('error', () => {
                errorOrClose = true;
            });
            server.close((_err) => {
                // Node.js passes an error to the callback for non-listening servers
                errorOrClose = true;
            });
            // Wait for async callback
            await new Promise<void>((resolve) =>
                setTimeout(() => {
                    expect(errorOrClose).toBe(true);
                    resolve();
                }, 100),
            );
        });
    });

    await describe('net socket error classification', async () => {
        // The classifier the tolerated-handler sites use, exercised over every code a
        // socket can produce. A test that tolerates "the peer reset" on one OS and
        // "nothing" on another is a claim about the HOST, and the only way to hold it
        // without a Windows machine is to pin the DECISION here: `isPeerReset` is a pure
        // function of the code, so this pins it identically on every leg, and the
        // tolerated handler is then just `!isPeerReset(err) → reject`.
        await it('classifies ECONNRESET as a peer reset and nothing else', async () => {
            // The one code tolerated: win32 reports it on a server socket whose client
            // closed without reading, where darwin/linux report a clean EOF.
            expect(isPeerReset(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
            // Our own write to a closed peer — a real fault, not a peer reset.
            expect(isPeerReset(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(false);
            // The stream layer, above the socket: `write after end` is a caller error.
            expect(
                isPeerReset(Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' })),
            ).toBe(false);
            // Anything unrecognised, and the shapes an absent code arrives in.
            expect(isPeerReset(Object.assign(new Error('boom'), { code: 'ENOTAREALCODE' }))).toBe(false);
            expect(isPeerReset(new Error('read ECONNRESET'))).toBe(false); // message without a code
            expect(isPeerReset(null)).toBe(false);
            expect(isPeerReset(undefined)).toBe(false);
        });

        // The tolerated handler is a decision, so pin the DECISION it makes on a
        // synthetic reset — the win32 branch, forced on a host that never produces one.
        await it('the tolerated handler passes a peer reset through and rejects the rest', async () => {
            const handled: string[] = [];
            const onSocketError = (err: Error & { code?: string }): void => {
                if (isPeerReset(err)) handled.push(err.code!);
                else handled.push(`REJECTED:${err.code ?? err.message}`);
            };
            onSocketError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
            onSocketError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
            expect(handled).toStrictEqual(['ECONNRESET', 'REJECTED:EPIPE']);
        });
    });

    await describe('net.Socket bytes tracking', async () => {
        await it('should track bytesWritten and bytesRead', async () => {
            const server = net.createServer((socket) => {
                socket.on('data', (data) => {
                    socket.write(data); // echo
                });
            });

            await new Promise<void>((resolve, reject) => {
                server.listen(0, () => {
                    const addr = server.address() as { port: number };
                    const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
                        const testData = 'Hello, World!';
                        client.write(testData);

                        client.on('data', () => {
                            expect(client.bytesWritten).toBeGreaterThan(0);
                            expect(client.bytesRead).toBeGreaterThan(0);
                            client.destroy();
                            server.close(() => resolve());
                        });
                    });
                    client.on('error', reject);
                });
                server.on('error', reject);
            });
        });
    });
};
