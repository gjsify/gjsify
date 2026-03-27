// Net error handling and lifecycle tests
// Ported from refs/node-test/parallel/test-net-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as net from 'node:net';

export default async () => {

  // ===================== Socket destroy idempotency =====================
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

  // ===================== Server getConnections =====================
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

  // ===================== Server maxConnections =====================
  await describe('net.Server.maxConnections', async () => {
    await it('should accept maxConnections property', async () => {
      const server = net.createServer();
      server.maxConnections = 5;
      expect(server.maxConnections).toBe(5);
      server.close();
    });
  });

  // Connection refused is already tested in index.spec.ts and server.spec.ts

  // ===================== Socket address =====================
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

  // ===================== Server close without listening =====================
  await describe('net.Server close edge cases', async () => {
    await it('should handle closing a non-listening server', async () => {
      const server = net.createServer();
      let errorOrClose = false;
      server.on('error', () => { errorOrClose = true; });
      server.close((err) => {
        // Node.js passes an error to the callback for non-listening servers
        errorOrClose = true;
      });
      // Wait for async callback
      await new Promise<void>((resolve) => setTimeout(() => {
        expect(errorOrClose).toBe(true);
        resolve();
      }, 100));
    });
  });

  // ===================== Socket bytesRead/bytesWritten =====================
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
