import { describe, it, expect, on } from '@gjsify/unit';
import net, { isIP, isIPv4, isIPv6, createServer, createConnection, connect, Socket, Server } from 'net';

export default async () => {
  await describe('net', async () => {

    // --- isIP comprehensive tests (ported from refs/node-test/parallel/test-net-isip.js) ---
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

      await it('should return 0 for invalid addresses', async () => {
        expect(isIP('')).toBe(0);
        expect(isIP('hello')).toBe(0);
        expect(isIP('not an ip')).toBe(0);
        expect(isIP('999.999.999.999')).toBe(0);
        expect(isIP('1.2.3')).toBe(0);
        expect(isIP('1.2.3.4.5')).toBe(0);
        expect(isIP('::banana')).toBe(0);
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
      });
    });

    await describe('isIPv6', async () => {
      await it('should return true for valid IPv6', async () => {
        expect(isIPv6('::1')).toBe(true);
        expect(isIPv6('fe80::1')).toBe(true);
        expect(isIPv6('::')).toBe(true);
      });

      await it('should return false for IPv4 and invalid', async () => {
        expect(isIPv6('127.0.0.1')).toBe(false);
        expect(isIPv6('')).toBe(false);
        expect(isIPv6('hello')).toBe(false);
      });
    });

    // --- Module exports ---
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

    // --- Socket ---
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

      await it('should have setTimeout method', async () => {
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
    });

    // --- Server ---
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
        let listenerCalled = false;
        const server = createServer(() => { listenerCalled = true; });
        expect(server).toBeDefined();
        expect(server.listening).toBe(false);
      });
    });

    // --- TCP connection tests (Node.js verified, GJS needs MainLoop) ---
    await on('Node.js', async () => {
      await describe('TCP connection', async () => {
        await it('should listen and connect', async () => {
          const server = createServer((socket) => {
            socket.write('hello');
            socket.end();
          });

          await new Promise<void>((resolve, reject) => {
            server.listen(0, () => {
              const addr = server.address();
              if (!addr || !('port' in addr)) {
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
              });
              client.on('error', reject);
            });
            server.on('error', reject);
          });
        });
      });
    });
  });
};
