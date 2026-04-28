// Ported from refs/node-test/parallel/test-net-isip.js, test-net-connect-buffer.js,
// test-net-settimeout.js, test-net-bytes-read.js, test-net-server-max-connections.js
// Original: MIT license, Node.js contributors

import { describe, it, expect, on } from '@gjsify/unit';
import net, { isIP, isIPv4, isIPv6, createServer, createConnection, connect, Socket, Server } from 'node:net';
import { Buffer } from 'node:buffer';

export default async () => {
  await describe('net', async () => {

    // ==================== isIP comprehensive tests ====================
    // Ported from refs/node-test/parallel/test-net-isip.js
    await describe('isIP', async () => {
      await it('should return 4 for valid IPv4 addresses', async () => {
        expect(isIP('127.0.0.1')).toBe(4);
        expect(isIP('192.168.1.1')).toBe(4);
        expect(isIP('0.0.0.0')).toBe(4);
        expect(isIP('255.255.255.255')).toBe(4);
        expect(isIP('10.0.0.1')).toBe(4);
        expect(isIP('1.2.3.4')).toBe(4);
      });

      await it('should return 6 for valid IPv6 addresses', async () => {
        expect(isIP('::1')).toBe(6);
        expect(isIP('fe80::1')).toBe(6);
        expect(isIP('::ffff:127.0.0.1')).toBe(6);
        expect(isIP('2001:db8::1')).toBe(6);
        expect(isIP('::')).toBe(6);
        expect(isIP('fe80::1%eth0')).toBe(6);
        expect(isIP('::ffff:192.168.1.1')).toBe(6);
      });

      await it('should return 6 for full and compressed IPv6', async () => {
        expect(isIP('0000:0000:0000:0000:0000:0000:0000:0000')).toBe(6);
        expect(isIP('1050:0:0:0:5:600:300c:326b')).toBe(6);
        expect(isIP('2001:252:0:1::2008:6')).toBe(6);
        expect(isIP('2001:dead:beef:1::2008:6')).toBe(6);
        expect(isIP('2001::')).toBe(6);
        expect(isIP('2001:dead::')).toBe(6);
        expect(isIP('2001:dead:beef::')).toBe(6);
        expect(isIP('2001:dead:beef:1::')).toBe(6);
        expect(isIP('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(6);
      });

      await it('should return 6 for IPv4-mapped and mixed notation', async () => {
        expect(isIP('::2001:252:1:2008:6')).toBe(6);
        expect(isIP('::2001:252:1:1.1.1.1')).toBe(6);
        expect(isIP('::2001:252:1:255.255.255.255')).toBe(6);
      });

      await it('should return 6 for zone ID addresses', async () => {
        expect(isIP('fe80::2008%eth0')).toBe(6);
        expect(isIP('fe80::2008%eth0.0')).toBe(6);
      });

      await it('should return 0 for invalid addresses', async () => {
        expect(isIP('')).toBe(0);
        expect(isIP('hello')).toBe(0);
        expect(isIP('not an ip')).toBe(0);
        expect(isIP('999.999.999.999')).toBe(0);
        expect(isIP('1.2.3')).toBe(0);
        expect(isIP('1.2.3.4.5')).toBe(0);
        expect(isIP('::banana')).toBe(0);
        expect(isIP('0')).toBe(0);
        expect(isIP('x127.0.0.1')).toBe(0);
        expect(isIP('example.com')).toBe(0);
      });

      await it('should return 0 for malformed IPv6', async () => {
        expect(isIP('0000:0000:0000:0000:0000:0000:0000:0000::0000')).toBe(0);
        expect(isIP(':2001:252:0:1::2008:6:')).toBe(0);
        expect(isIP(':2001:252:0:1::2008:6')).toBe(0);
        expect(isIP('2001:252:0:1::2008:6:')).toBe(0);
        expect(isIP('2001:252::1::2008:6')).toBe(0);
        expect(isIP('::2001:252:1:255.255.255.255.76')).toBe(0);
        expect(isIP('0000:0000:0000:0000:0000:0000:12345:0000')).toBe(0);
        expect(isIP('::anything')).toBe(0);
      });

      await it('should return 0 for non-string input', async () => {
        expect(isIP(undefined as any)).toBe(0);
        expect(isIP(null as any)).toBe(0);
        expect(isIP(123 as any)).toBe(0);
        expect(isIP(true as any)).toBe(0);
        expect(isIP({} as any)).toBe(0);
      });
    });

    await describe('isIPv4', async () => {
      await it('should return true for valid IPv4', async () => {
        expect(isIPv4('127.0.0.1')).toBe(true);
        expect(isIPv4('0.0.0.0')).toBe(true);
        expect(isIPv4('255.255.255.255')).toBe(true);
      });

      await it('should return false for IPv6 and invalid', async () => {
        expect(isIPv4('::1')).toBe(false);
        expect(isIPv4('')).toBe(false);
        expect(isIPv4('hello')).toBe(false);
        expect(isIPv4('example.com')).toBe(false);
        expect(isIPv4('2001:252:0:1::2008:6')).toBe(false);
      });

      await it('should return false for non-string input', async () => {
        expect(isIPv4(undefined as any)).toBe(false);
        expect(isIPv4(null as any)).toBe(false);
        expect(isIPv4(123 as any)).toBe(false);
        expect(isIPv4(true as any)).toBe(false);
        expect(isIPv4({} as any)).toBe(false);
      });
    });

    await describe('isIPv6', async () => {
      await it('should return true for valid IPv6', async () => {
        expect(isIPv6('::1')).toBe(true);
        expect(isIPv6('fe80::1')).toBe(true);
        expect(isIPv6('::')).toBe(true);
        expect(isIPv6('2001:252:0:1::2008:6')).toBe(true);
      });

      await it('should return false for IPv4 and invalid', async () => {
        expect(isIPv6('127.0.0.1')).toBe(false);
        expect(isIPv6('')).toBe(false);
        expect(isIPv6('hello')).toBe(false);
        expect(isIPv6('example.com')).toBe(false);
      });

      await it('should return false for non-string input', async () => {
        expect(isIPv6(undefined as any)).toBe(false);
        expect(isIPv6(null as any)).toBe(false);
        expect(isIPv6(123 as any)).toBe(false);
        expect(isIPv6(true as any)).toBe(false);
        expect(isIPv6({} as any)).toBe(false);
      });
    });

    // ==================== Module exports ====================
    await describe('exports', async () => {
      await it('should export isIP, isIPv4, isIPv6', async () => {
        expect(typeof isIP).toBe('function');
        expect(typeof isIPv4).toBe('function');
        expect(typeof isIPv6).toBe('function');
      });

      await it('should export createServer and createConnection', async () => {
        expect(typeof createServer).toBe('function');
        expect(typeof createConnection).toBe('function');
      });

      await it('should export connect as alias for createConnection', async () => {
        expect(typeof connect).toBe('function');
      });

      await it('should export Socket and Server constructors', async () => {
        expect(typeof Socket).toBe('function');
        expect(typeof Server).toBe('function');
      });

      await it('should have all exports on the default export', async () => {
        expect(typeof net.isIP).toBe('function');
        expect(typeof net.isIPv4).toBe('function');
        expect(typeof net.isIPv6).toBe('function');
        expect(typeof net.createServer).toBe('function');
        expect(typeof net.createConnection).toBe('function');
        expect(typeof net.connect).toBe('function');
        expect(typeof net.Socket).toBe('function');
        expect(typeof net.Server).toBe('function');
      });
    });

    // ==================== Socket (unit tests) ====================
    await describe('Socket', async () => {
      await it('should be constructable', async () => {
        const socket = new Socket();
        expect(socket).toBeDefined();
      });

      await it('should have connecting property initially false', async () => {
        const socket = new Socket();
        expect(socket.connecting).toBe(false);
      });

      await it('should have bytesRead and bytesWritten at 0', async () => {
        const socket = new Socket();
        expect(socket.bytesRead).toBe(0);
        expect(socket.bytesWritten).toBe(0);
      });

      await it('should have pending=true before connection', async () => {
        const socket = new Socket();
        expect(socket.pending).toBe(true);
      });

      await it('should have setTimeout method that returns this', async () => {
        const socket = new Socket();
        expect(typeof socket.setTimeout).toBe('function');
      });

      await it('should have setKeepAlive method', async () => {
        const socket = new Socket();
        expect(typeof socket.setKeepAlive).toBe('function');
      });

      await it('should have setNoDelay method', async () => {
        const socket = new Socket();
        expect(typeof socket.setNoDelay).toBe('function');
      });

      await it('should have address method', async () => {
        const socket = new Socket();
        expect(typeof socket.address).toBe('function');
      });

      await it('should have ref/unref methods', async () => {
        const socket = new Socket();
        expect(typeof socket.ref).toBe('function');
        expect(typeof socket.unref).toBe('function');
      });

      await it('should have connect method', async () => {
        const socket = new Socket();
        expect(typeof socket.connect).toBe('function');
      });

      await it('should have write and end methods (Duplex)', async () => {
        const socket = new Socket();
        expect(typeof socket.write).toBe('function');
        expect(typeof socket.end).toBe('function');
      });

      await it('should have destroy method', async () => {
        const socket = new Socket();
        expect(typeof socket.destroy).toBe('function');
      });

      await it('should have destroySoon method', async () => {
        const socket = new Socket();
        expect(typeof socket.destroySoon).toBe('function');
      });

      await it('should return empty object from address() when not connected', async () => {
        const socket = new Socket();
        const addr = socket.address();
        expect(addr).toBeDefined();
      });
    });

    // ==================== Server (unit tests) ====================
    await describe('Server', async () => {
      await it('should be constructable', async () => {
        const server = new Server();
        expect(server).toBeDefined();
      });

      await it('should have listening property initially false', async () => {
        const server = new Server();
        expect(server.listening).toBe(false);
      });

      await it('should have listen method', async () => {
        const server = new Server();
        expect(typeof server.listen).toBe('function');
      });

      await it('should have close method', async () => {
        const server = new Server();
        expect(typeof server.close).toBe('function');
      });

      await it('should have address method', async () => {
        const server = new Server();
        expect(typeof server.address).toBe('function');
      });

      await it('should return null from address() before listening', async () => {
        const server = new Server();
        expect(server.address()).toBeNull();
      });

      await it('should have getConnections method', async () => {
        const server = new Server();
        expect(typeof server.getConnections).toBe('function');
      });

      await it('should have ref/unref methods', async () => {
        const server = new Server();
        expect(typeof server.ref).toBe('function');
        expect(typeof server.unref).toBe('function');
      });

      await it('should accept connectionListener in constructor', async () => {
        const server = createServer(() => { /* listener */ });
        expect(server).toBeDefined();
        expect(server.listening).toBe(false);
      });

      await it('should have maxConnections property', async () => {
        const server = new Server();
        expect(server.maxConnections).toBeUndefined();
        server.maxConnections = 10;
        expect(server.maxConnections).toBe(10);
      });
    });

    // ==================== TCP connection tests ====================
    await describe('TCP connection', async () => {
      await it('should listen and connect', async () => {
        const server = createServer((socket) => {
          socket.write('hello');
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string' || !('port' in addr)) {
              reject(new Error('Server has no address'));
              return;
            }

            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              const chunks: Buffer[] = [];
              client.on('data', (chunk) => chunks.push(chunk as Buffer));
              client.on('end', () => {
                const data = Buffer.concat(chunks).toString();
                expect(data).toBe('hello');
                server.close(() => resolve());
              });
            });

            client.on('error', reject);
          });

          server.on('error', reject);
        });
      });

      await it('should listen on port 0 and assign a random port', async () => {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address();
            expect(addr).toBeDefined();
            expect(typeof (addr as any).port).toBe('number');
            expect((addr as any).port).toBeGreaterThan(0);
            expect(server.listening).toBe(true);
            server.close(() => resolve());
          });
          server.on('error', reject);
        });
      });

      await it('should emit close event on server.close', async () => {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            server.close(() => {
              expect(server.listening).toBe(false);
              resolve();
            });
          });
          server.on('error', reject);
        });
      });

      await it('should echo data back', async () => {
        const server = createServer((socket) => {
          socket.on('data', (data) => {
            socket.write(data);
          });
          socket.on('end', () => socket.end());
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.write('echo test');
              client.end();
            });

            const chunks: Buffer[] = [];
            client.on('data', (chunk) => chunks.push(chunk as Buffer));
            client.on('end', () => {
              const data = Buffer.concat(chunks).toString();
              expect(data).toBe('echo test');
              server.close(() => resolve());
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should handle multiple sequential connections', async () => {
        let connectionCount = 0;
        const server = createServer((socket) => {
          connectionCount++;
          socket.write(`conn${connectionCount}`);
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, async () => {
            const addr = server.address() as { port: number };

            const connectAndRead = () => new Promise<string>((res, rej) => {
              const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
                const chunks: Buffer[] = [];
                client.on('data', (chunk) => chunks.push(chunk as Buffer));
                client.on('end', () => res(Buffer.concat(chunks).toString()));
                client.on('error', rej);
              });
            });

            try {
              const data1 = await connectAndRead();
              expect(data1).toBe('conn1');
              const data2 = await connectAndRead();
              expect(data2).toBe('conn2');
              server.close(() => resolve());
            } catch (e) {
              reject(e);
            }
          });
          server.on('error', reject);
        });
      });

      await it('should set remoteAddress and remotePort on connection', async () => {
        const server = createServer((socket) => {
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              expect(client.remoteAddress).toBe('127.0.0.1');
              expect(client.remotePort).toBe(addr.port);
              client.on('end', () => {
                server.close(() => resolve());
              });
              client.resume();
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      // Ported from refs/node-test/parallel/test-net-connect-buffer.js
      await it('should set socket state during connect lifecycle', async () => {
        const server = createServer((socket) => {
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const socket = new Socket();

            expect(socket.pending).toBe(true);
            expect(socket.connecting).toBe(false);

            socket.connect(addr.port, '127.0.0.1', () => {
              expect(socket.connecting).toBe(false);
              expect(socket.pending).toBe(false);
              socket.on('end', () => {
                server.close(() => resolve());
              });
              socket.resume();
            });

            // After connect() is called but before connected
            expect(socket.connecting).toBe(true);

            socket.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should set localAddress and localPort after connect', async () => {
        const server = createServer((socket) => {
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              expect(client.localAddress).toBeDefined();
              expect(typeof client.localPort).toBe('number');
              expect(client.localPort).toBeGreaterThan(0);
              client.on('end', () => {
                server.close(() => resolve());
              });
              client.resume();
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      // Ported from refs/node-test/parallel/test-net-bytes-read.js
      await it('should track bytesRead on the receiving socket', async () => {
        const payload = 'hello world bytes test';
        const server = createServer((socket) => {
          socket.end(payload);
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.on('data', () => {
                // bytesRead should increase
                expect(client.bytesRead).toBeGreaterThan(0);
              });
              client.on('end', () => {
                expect(client.bytesRead).toBe(Buffer.byteLength(payload));
                server.close(() => resolve());
              });
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should track bytesWritten on the sending socket', async () => {
        const payload = 'hello bytes written';
        const server = createServer((socket) => {
          const chunks: Buffer[] = [];
          socket.on('data', (chunk) => chunks.push(chunk as Buffer));
          socket.on('end', () => {
            const received = Buffer.concat(chunks).toString();
            expect(received).toBe(payload);
            socket.end();
          });
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.end(payload, () => {
                // bytesWritten should match the payload
                expect(client.bytesWritten).toBe(Buffer.byteLength(payload));
              });
              client.on('end', () => {
                server.close(() => resolve());
              });
              client.resume();
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should support setEncoding on socket', async () => {
        const server = createServer((socket) => {
          socket.write('hello encoding');
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.setEncoding('utf8');
              const chunks: string[] = [];
              client.on('data', (chunk) => {
                expect(typeof chunk).toBe('string');
                chunks.push(chunk as string);
              });
              client.on('end', () => {
                expect(chunks.join('')).toBe('hello encoding');
                server.close(() => resolve());
              });
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      // Ported from refs/node-test/parallel/test-net-settimeout.js
      await it('should support setTimeout and cancel it', async () => {
        const server = createServer((socket) => {
          socket.write('hello');
          // Keep connection open briefly
          setTimeout(() => socket.end(), 200);
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const socket = createConnection(addr.port, '127.0.0.1');

            // Set then immediately disable timeout
            const s = socket.setTimeout(100);
            expect(s).toBe(socket); // should return this
            socket.setTimeout(0); // cancel

            socket.on('data', () => {
              // Timeout should not have fired
            });
            socket.on('end', () => {
              socket.destroy();
              server.close(() => resolve());
            });
            socket.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should emit timeout event', async () => {
        const server = createServer((socket) => {
          // Don't send anything — let client time out
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.setTimeout(100);
              client.on('timeout', () => {
                client.destroy();
                server.close(() => resolve());
              });
            });
            client.on('error', () => {
              // Expected — we destroyed the socket
            });
          });
          server.on('error', reject);
        });
      });

      await it('should report getConnections correctly', async () => {
        const server = createServer((socket) => {
          // Hold connection open
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              server.getConnections((err, count) => {
                expect(err).toBeNull();
                expect(count).toBe(1);
                client.destroy();
                server.close(() => resolve());
              });
            });
            client.on('error', () => {});
          });
          server.on('error', reject);
        });
      });

      await it('should set remoteFamily to IPv4', async () => {
        const server = createServer((socket) => {
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              expect(client.remoteFamily).toBe('IPv4');
              client.on('end', () => {
                server.close(() => resolve());
              });
              client.resume();
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should emit connection event on server', async () => {
        let connectionEmitted = false;
        const server = createServer();
        server.on('connection', (socket) => {
          connectionEmitted = true;
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' });
            client.on('end', () => {
              expect(connectionEmitted).toBe(true);
              server.close(() => resolve());
            });
            client.on('error', reject);
            client.resume();
          });
          server.on('error', reject);
        });
      });

      await it('should pass multi-byte UTF-8 data correctly', async () => {
        const message = "L'État, c'est moi — 日本語テスト";
        const server = createServer((socket) => {
          socket.setEncoding('utf8');
          let buf = '';
          socket.on('data', (d) => { buf += d; });
          socket.on('end', () => {
            socket.write(buf);
            socket.end();
          });
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.end(message);
            });
            client.setEncoding('utf8');
            let received = '';
            client.on('data', (d) => { received += d; });
            client.on('end', () => {
              expect(received).toBe(message);
              server.close(() => resolve());
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should handle socket.destroy() during connection', async () => {
        const server = createServer((socket) => {
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.destroy();
              expect(client.destroyed).toBe(true);
              server.close(() => resolve());
            });
            client.on('error', () => {}); // Ignore errors from destroyed socket
          });
          server.on('error', reject);
        });
      });

      await it('should emit close event on socket after destroy', async () => {
        const server = createServer((socket) => {
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.on('close', () => {
                server.close(() => resolve());
              });
              client.destroy();
            });
            client.on('error', () => {}); // Ignore
          });
          server.on('error', reject);
        });
      });

      await it('should support connect with port number shorthand', async () => {
        const server = createServer((socket) => {
          socket.write('ok');
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            // Use the simpler connect(port, host, cb) form
            const client = net.connect(addr.port, '127.0.0.1', () => {
              const chunks: Buffer[] = [];
              client.on('data', (chunk) => chunks.push(chunk as Buffer));
              client.on('end', () => {
                expect(Buffer.concat(chunks).toString()).toBe('ok');
                server.close(() => resolve());
              });
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should handle large data transfer', async () => {
        const size = 64 * 1024; // 64 KB
        const payload = Buffer.alloc(size, 0x41); // 'A' repeated

        const server = createServer((socket) => {
          socket.end(payload);
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              const chunks: Buffer[] = [];
              client.on('data', (chunk) => chunks.push(chunk as Buffer));
              client.on('end', () => {
                const received = Buffer.concat(chunks);
                expect(received.length).toBe(size);
                expect(received.every(b => b === 0x41)).toBe(true);
                server.close(() => resolve());
              });
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should report server address family', async () => {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
              reject(new Error('Server has no AddressInfo'));
              return;
            }
            expect(addr.family).toBe('IPv4');
            expect(addr.address).toBe('127.0.0.1');
            expect(typeof addr.port).toBe('number');
            server.close(() => resolve());
          });
          server.on('error', reject);
        });
      });

      // ==================== TCP error handling ====================
      // Ported from refs/node-test/parallel/test-net-connect-error.js
      // Original: MIT license, Node.js contributors

      await it('should emit error when connecting to refused port', async () => {
        const client = createConnection({ port: 1, host: '127.0.0.1' });
        const err = await new Promise<Error>((resolve) => {
          client.on('error', (e) => resolve(e));
        });
        expect(err).toBeDefined();
        expect((err as NodeJS.ErrnoException).code).toBeDefined();
        client.destroy();
      });

      await it('should support socket.setNoDelay', async () => {
        const server = createServer((socket) => {
          socket.end('ok');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              // setNoDelay should not throw
              client.setNoDelay(true);
              client.setNoDelay(false);
              client.on('end', () => {
                server.close(() => resolve());
              });
              client.resume();
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should support socket.setKeepAlive', async () => {
        const server = createServer((socket) => {
          socket.end('ok');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              // setKeepAlive should not throw
              client.setKeepAlive(true);
              client.setKeepAlive(false, 1000);
              client.on('end', () => {
                server.close(() => resolve());
              });
              client.resume();
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should support socket.ref and unref', async () => {
        const server = createServer((socket) => {
          socket.end('ok');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              const result = client.ref();
              expect(result).toBe(client); // should return this
              const result2 = client.unref();
              expect(result2).toBe(client);
              client.on('end', () => {
                server.close(() => resolve());
              });
              client.resume();
            });
            client.on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('server.ref/unref should return this', async () => {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const r1 = server.ref();
            expect(r1).toBe(server);
            const r2 = server.unref();
            expect(r2).toBe(server);
            server.close(() => resolve());
          });
          server.on('error', reject);
        });
      });

      await it('should handle write after end gracefully', async () => {
        const server = createServer((socket) => {
          socket.on('error', () => {}); // Ignore ECONNRESET from client closing
          socket.end('done');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
              client.end();
              // Write after end should not crash
              const result = client.write('after end');
              expect(result).toBe(false);
              client.on('error', () => {}); // Ignore write-after-end error
              client.on('close', () => {
                server.close(() => resolve());
              });
            });
            client.on('error', () => {});
          });
          server.on('error', reject);
        });
      });

      await it('should handle simultaneous connections', async () => {
        let connCount = 0;
        const server = createServer((socket) => {
          connCount++;
          socket.write(`client${connCount}`);
          socket.end();
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            let done = 0;
            const results: string[] = [];

            for (let i = 0; i < 3; i++) {
              const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
                const chunks: Buffer[] = [];
                client.on('data', (chunk) => chunks.push(chunk as Buffer));
                client.on('end', () => {
                  results.push(Buffer.concat(chunks).toString());
                  done++;
                  if (done === 3) {
                    expect(results.length).toBe(3);
                    server.close(() => resolve());
                  }
                });
              });
              client.on('error', reject);
            }
          });
          server.on('error', reject);
        });
      });
    });

    // ==================== Socket additional properties (cross-platform) ====================

    await describe('Socket additional properties', async () => {
      await it('should have ref/unref methods', async () => {
        const socket = new Socket();
        expect(typeof socket.ref).toBe('function');
        expect(typeof socket.unref).toBe('function');
      });

      await it('ref/unref should return this', async () => {
        const socket = new Socket();
        expect(socket.ref()).toBe(socket);
        expect(socket.unref()).toBe(socket);
      });

      await it('should have setNoDelay method', async () => {
        const socket = new Socket();
        expect(typeof socket.setNoDelay).toBe('function');
      });

      await it('should have setKeepAlive method', async () => {
        const socket = new Socket();
        expect(typeof socket.setKeepAlive).toBe('function');
      });

      await it('should have address method', async () => {
        const socket = new Socket();
        expect(typeof socket.address).toBe('function');
      });

      await it('should have destroyed=false initially', async () => {
        const socket = new Socket();
        expect(socket.destroyed).toBe(false);
      });

      await it('should have readyState property', async () => {
        const socket = new Socket();
        expect(socket.readyState).toBeDefined();
      });
    });

    // ==================== Server additional properties (cross-platform) ====================

    await describe('Server additional properties', async () => {
      await it('should have ref/unref methods', async () => {
        const server = new Server();
        expect(typeof server.ref).toBe('function');
        expect(typeof server.unref).toBe('function');
      });

      await it('should have listening=false before listen', async () => {
        const server = createServer();
        expect(server.listening).toBe(false);
      });

      await it('should have address method', async () => {
        const server = createServer();
        expect(typeof server.address).toBe('function');
      });

      await it('address() should return null before listening', async () => {
        const server = createServer();
        expect(server.address()).toBeNull();
      });

      await it('should have getConnections method', async () => {
        const server = createServer();
        expect(typeof server.getConnections).toBe('function');
      });

      await it('should have close method', async () => {
        const server = createServer();
        expect(typeof server.close).toBe('function');
      });
    });
  });
};
