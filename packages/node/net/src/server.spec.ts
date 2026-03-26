// TCP server/client integration tests — connection lifecycle, data transfer, error handling
// Reference: refs/node-test/parallel/test-net-*.js

import { describe, it, expect } from '@gjsify/unit';
import { createServer, createConnection, Socket, Server } from 'node:net';
import { Buffer } from 'node:buffer';

/** Helper: create server, run test, cleanup */
function withServer(handler: (server: Server, port: number) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      handler(server, addr.port)
        .then(() => {
          server.close();
          resolve();
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

export default async () => {
  // ---- TCP Echo ----

  await describe('net TCP: echo server', async () => {
    await it('should echo data back to client', async () => {
      await withServer(async (server, port) => {
        server.on('connection', (socket) => {
          socket.on('data', (data) => socket.write(data));
        });
        const result = await new Promise<string>((resolve, reject) => {
          const client = createConnection({ port, host: '127.0.0.1' }, () => {
            client.write('hello echo');
          });
          client.setEncoding('utf8');
          client.on('data', (data) => {
            client.end();
            resolve(data);
          });
          client.on('error', reject);
        });
        expect(result).toBe('hello echo');
      });
    });

    await it('should echo a second message after first completes', async () => {
      await withServer(async (server, port) => {
        server.on('connection', (socket) => {
          socket.on('data', (data) => socket.write(data));
        });
        // Send one message, wait for echo, then send another
        const result = await new Promise<string>((resolve, reject) => {
          const client = createConnection({ port, host: '127.0.0.1' }, () => {
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
          client.on('error', reject);
        });
        expect(result).toBe('firstsecond');
      });
    });
  });

  // ---- Large data transfer ----

  await describe('net TCP: large data transfer', async () => {
    await it('should transfer 64KB of data', async () => {
      const size = 64 * 1024;
      const data = Buffer.alloc(size, 0x41); // 'A'
      await withServer(async (server, port) => {
        server.on('connection', (socket) => {
          socket.write(data);
          socket.end();
        });
        const received = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const client = createConnection({ port, host: '127.0.0.1' });
          client.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          client.on('end', () => resolve(Buffer.concat(chunks)));
          client.on('error', reject);
        });
        expect(received.length).toBe(size);
      });
    });
  });

  // ---- Connection events ----

  await describe('net TCP: connection events', async () => {
    await it('should emit connect event on client', async () => {
      await withServer(async (server, port) => {
        server.on('connection', (socket) => socket.end());
        const connected = await new Promise<boolean>((resolve) => {
          const client = createConnection({ port, host: '127.0.0.1' });
          client.on('connect', () => {
            client.end();
            resolve(true);
          });
        });
        expect(connected).toBe(true);
      });
    });

    await it('should emit close event after end', async () => {
      await withServer(async (server, port) => {
        server.on('connection', (socket) => socket.end('bye'));
        const closed = await new Promise<boolean>((resolve) => {
          const client = createConnection({ port, host: '127.0.0.1' });
          client.on('close', () => resolve(true));
          client.resume(); // Consume data to allow close
        });
        expect(closed).toBe(true);
      });
    });

    await it('should emit end event when server closes', async () => {
      await withServer(async (server, port) => {
        server.on('connection', (socket) => socket.end());
        const ended = await new Promise<boolean>((resolve) => {
          const client = createConnection({ port, host: '127.0.0.1' });
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
      await withServer(async (server, port) => {
        server.on('connection', (socket) => {
          connectionCount++;
          socket.end();
        });
        for (let i = 0; i < 3; i++) {
          await new Promise<void>((resolve) => {
            const client = createConnection({ port, host: '127.0.0.1' });
            client.on('close', () => resolve());
            client.resume();
          });
        }
      });
      expect(connectionCount).toBe(3);
    });
  });

  // ---- Server properties ----

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

  // ---- Socket properties ----

  await describe('net TCP: socket properties', async () => {
    await it('should expose remoteAddress and remotePort after connect', async () => {
      await withServer(async (server, port) => {
        server.on('connection', (socket) => socket.end());
        const { remoteAddress, remotePort } = await new Promise<{ remoteAddress: string; remotePort: number }>((resolve) => {
          const client = createConnection({ port, host: '127.0.0.1' }, () => {
            resolve({
              remoteAddress: client.remoteAddress!,
              remotePort: client.remotePort!,
            });
            client.end();
          });
        });
        expect(remoteAddress).toBe('127.0.0.1');
        expect(remotePort).toBe(port);
      });
    });

    await it('should expose localPort after connect', async () => {
      await withServer(async (server, port) => {
        server.on('connection', (socket) => socket.end());
        const localPort = await new Promise<number>((resolve) => {
          const client = createConnection({ port, host: '127.0.0.1' }, () => {
            resolve(client.localPort!);
            client.end();
          });
        });
        expect(localPort).toBeGreaterThan(0);
      });
    });
  });

  // ---- Data encoding ----

  await describe('net TCP: data encoding', async () => {
    await it('should transfer UTF-8 strings', async () => {
      const testStr = 'Hallo Welt! 你好世界';
      await withServer(async (server, port) => {
        server.on('connection', (socket) => {
          socket.write(testStr, 'utf8');
          socket.end();
        });
        const received = await new Promise<string>((resolve, reject) => {
          const chunks: string[] = [];
          const client = createConnection({ port, host: '127.0.0.1' });
          client.setEncoding('utf8');
          client.on('data', (data) => chunks.push(data));
          client.on('end', () => resolve(chunks.join('')));
          client.on('error', reject);
        });
        expect(received).toBe(testStr);
      });
    });

    await it('should transfer binary data', async () => {
      const binary = Buffer.from([0x00, 0x01, 0x80, 0xff, 0xfe]);
      await withServer(async (server, port) => {
        server.on('connection', (socket) => {
          socket.write(binary);
          socket.end();
        });
        const received = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const client = createConnection({ port, host: '127.0.0.1' });
          client.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          client.on('end', () => resolve(Buffer.concat(chunks)));
          client.on('error', reject);
        });
        expect(received.length).toBe(5);
        expect(received[0]).toBe(0x00);
        expect(received[2]).toBe(0x80);
        expect(received[4]).toBe(0xfe);
      });
    });
  });

  // ---- Error handling ----

  await describe('net TCP: error handling', async () => {
    await it('should emit error for connection refused', async () => {
      const err = await new Promise<Error>((resolve) => {
        // Port 1 is almost certainly not listening
        const client = createConnection({ port: 1, host: '127.0.0.1' });
        client.on('error', (e) => resolve(e));
      });
      expect(err).toBeDefined();
      expect((err as NodeJS.ErrnoException).code).toBeDefined();
    });

    await it('should handle server close while client connected', async () => {
      const server = createServer((socket) => {
        // Close server immediately
        server.close();
        socket.end('goodbye');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as { port: number }).port;

      const data = await new Promise<string>((resolve) => {
        const client = createConnection({ port, host: '127.0.0.1' });
        client.setEncoding('utf8');
        const chunks: string[] = [];
        client.on('data', (chunk) => chunks.push(chunk));
        client.on('end', () => resolve(chunks.join('')));
      });
      expect(data).toBe('goodbye');
    });
  });
};
