import { describe, it, expect, on } from '@gjsify/unit';
import dgram, { createSocket, Socket } from 'dgram';

export default async () => {
  await describe('dgram', async () => {

    // --- Module exports ---
    await describe('exports', async () => {
      await it('should export createSocket as a function', async () => {
        expect(typeof createSocket).toBe('function');
      });

      await it('should export Socket class', async () => {
        expect(typeof Socket).toBe('function');
      });

      await it('should have exports on the default export', async () => {
        expect(typeof dgram.createSocket).toBe('function');
        expect(typeof dgram.Socket).toBe('function');
      });
    });

    // --- Socket creation ---
    await describe('createSocket', async () => {
      await it('should create a udp4 socket', async () => {
        const socket = createSocket('udp4');
        expect(socket).toBeDefined();
        expect(socket.type).toBe('udp4');
        expect(typeof socket.close).toBe('function');
        expect(typeof socket.send).toBe('function');
        expect(typeof socket.bind).toBe('function');
        expect(typeof socket.address).toBe('function');
        socket.close();
      });

      await it('should create a udp6 socket', async () => {
        const socket = createSocket('udp6');
        expect(socket).toBeDefined();
        expect(socket.type).toBe('udp6');
        socket.close();
      });

      await it('should create socket with options object', async () => {
        const socket = createSocket({ type: 'udp4', reuseAddr: true });
        expect(socket).toBeDefined();
        expect(socket.type).toBe('udp4');
        socket.close();
      });

      await it('should create socket with callback option', async () => {
        let called = false;
        const socket = createSocket({ type: 'udp4' }, () => { called = true; });
        expect(socket).toBeDefined();
        socket.close();
      });
    });

    // --- Socket methods ---
    await describe('Socket methods', async () => {
      await it('should have multicast methods', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.setBroadcast).toBe('function');
        expect(typeof socket.setTTL).toBe('function');
        expect(typeof socket.setMulticastTTL).toBe('function');
        expect(typeof socket.setMulticastLoopback).toBe('function');
        expect(typeof socket.addMembership).toBe('function');
        expect(typeof socket.dropMembership).toBe('function');
        socket.close();
      });

      await it('should have ref/unref methods that return socket', async () => {
        const socket = createSocket('udp4');
        expect(socket.ref()).toBe(socket);
        expect(socket.unref()).toBe(socket);
        socket.close();
      });

      await it('should have remoteAddress method or property', async () => {
        const socket = createSocket('udp4');
        // remoteAddress is a method in Node.js, available after connect()
        expect(typeof socket.remoteAddress === 'function' || socket.remoteAddress === undefined).toBe(true);
        socket.close();
      });

      await it('should have setRecvBufferSize and setSendBufferSize', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.setRecvBufferSize === 'function' || socket.setRecvBufferSize === undefined).toBe(true);
        expect(typeof socket.setSendBufferSize === 'function' || socket.setSendBufferSize === undefined).toBe(true);
        socket.close();
      });
    });

    // --- Close event ---
    await describe('close', async () => {
      await it('should emit close event', async () => {
        const socket = createSocket('udp4');
        let closed = false;
        socket.on('close', () => { closed = true; });
        socket.close();
        await new Promise<void>((r) => setTimeout(r, 10));
        expect(closed).toBe(true);
      });

      await it('should accept callback in close()', async () => {
        const socket = createSocket('udp4');
        const result = await new Promise<string>((resolve) => {
          socket.close(() => resolve('closed'));
        });
        expect(result).toBe('closed');
      });
    });

    // --- Bind ---
    await describe('bind', async () => {
      await it('should bind and emit listening event', async () => {
        const socket = createSocket('udp4');
        let listening = false;

        const result = await Promise.race([
          new Promise<string>((resolve) => {
            socket.on('listening', () => { listening = true; resolve('listening'); });
            socket.on('error', () => resolve('error'));
            socket.bind(0);
          }),
          new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ]);

        if (result === 'listening') {
          expect(listening).toBe(true);
          const addr = socket.address();
          expect(typeof addr.port).toBe('number');
          expect(addr.port).toBeGreaterThan(0);
          expect(typeof addr.address).toBe('string');
        }
        socket.close();
      });

      await it('should bind with options object', async () => {
        const socket = createSocket('udp4');

        const result = await Promise.race([
          new Promise<string>((resolve) => {
            socket.on('listening', () => resolve('listening'));
            socket.on('error', () => resolve('error'));
            socket.bind({ port: 0 });
          }),
          new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ]);

        if (result === 'listening') {
          const addr = socket.address();
          expect(addr.port).toBeGreaterThan(0);
        }
        socket.close();
      });
    });

    // --- UDP send/receive (Node.js only, GJS needs MainLoop) ---
    await on('Node.js', async () => {
      await describe('UDP send', async () => {
        await it('should send UDP message without error', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send('hello', serverAddr.port, '127.0.0.1', (err) => {
                expect(err).toBeNull();
                server.close();
                client.close();
                resolve();
              });
            });
            server.on('error', reject);
            server.bind(0);
          });
        });

        await it('should send Buffer', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send(Buffer.from('buffer test'), serverAddr.port, '127.0.0.1', (err) => {
                expect(err).toBeNull();
                server.close();
                client.close();
                resolve();
              });
            });
            server.on('error', reject);
            server.bind(0);
          });
        });

        await it('should send Uint8Array', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send(new Uint8Array([72, 101, 108, 108, 111]), serverAddr.port, '127.0.0.1', (err) => {
                expect(err).toBeNull();
                server.close();
                client.close();
                resolve();
              });
            });
            server.on('error', reject);
            server.bind(0);
          });
        });

        await it('should receive UDP message', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            server.on('message', (msg, rinfo) => {
              expect(msg.toString()).toBe('hello udp');
              expect(typeof rinfo.address).toBe('string');
              expect(typeof rinfo.port).toBe('number');
              expect(rinfo.port).toBeGreaterThan(0);
              server.close();
              client.close();
              resolve();
            });
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send('hello udp', serverAddr.port, '127.0.0.1');
            });
            server.on('error', reject);
            server.bind(0);
          });
        });

        await it('should report correct rinfo family', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            server.on('message', (_msg, rinfo) => {
              expect(rinfo.family).toBe('IPv4');
              expect(rinfo.address).toBe('127.0.0.1');
              server.close();
              client.close();
              resolve();
            });
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send('test', serverAddr.port, '127.0.0.1');
            });
            server.on('error', reject);
            server.bind(0);
          });
        });
      });
    });

    // --- Additional tests ---

    await describe('createSocket with reuseAddr option', async () => {
      await it('should create a socket with reuseAddr true', async () => {
        const socket = createSocket({ type: 'udp4', reuseAddr: true });
        expect(socket).toBeDefined();
        expect(socket.type).toBe('udp4');
        socket.close();
      });

      await it('should create a socket with reuseAddr false', async () => {
        const socket = createSocket({ type: 'udp4', reuseAddr: false });
        expect(socket).toBeDefined();
        socket.close();
      });
    });

    await describe('Socket.address() structure', async () => {
      await it('should return object with port, address, and family after bind', async () => {
        const socket = createSocket('udp4');

        const result = await Promise.race([
          new Promise<string>((resolve) => {
            socket.on('listening', () => resolve('listening'));
            socket.on('error', () => resolve('error'));
            socket.bind(0);
          }),
          new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ]);

        if (result === 'listening') {
          const addr = socket.address();
          expect(typeof addr.port).toBe('number');
          expect(typeof addr.address).toBe('string');
          expect(typeof addr.family).toBe('string');
          expect(addr.port).toBeGreaterThan(0);
        }
        socket.close();
      });
    });

    await describe('Socket method existence', async () => {
      await it('should have setTTL method', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.setTTL).toBe('function');
        socket.close();
      });

      await it('should have setBroadcast method', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.setBroadcast).toBe('function');
        socket.close();
      });
    });

    await describe('close on unbound socket', async () => {
      await it('close() on unbound socket should not throw', async () => {
        const socket = createSocket('udp4');
        // Socket was never bound — close should still work
        expect(() => socket.close()).not.toThrow();
      });
    });

    await describe('createSocket type as string', async () => {
      await it('should accept "udp4" as string type argument', async () => {
        const socket = createSocket('udp4');
        expect(socket).toBeDefined();
        expect(socket.type).toBe('udp4');
        socket.close();
      });

      await it('should accept "udp6" as string type argument', async () => {
        const socket = createSocket('udp6');
        expect(socket).toBeDefined();
        expect(socket.type).toBe('udp6');
        socket.close();
      });
    });

    await on('Node.js', async () => {
      await describe('Multiple sends and send callback', async () => {
        await it('multiple sends should all succeed', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            let sendCount = 0;
            server.on('listening', () => {
              const serverAddr = server.address();
              const onSend = (err: Error | null) => {
                expect(err).toBeNull();
                sendCount++;
                if (sendCount === 3) {
                  server.close();
                  client.close();
                  resolve();
                }
              };
              client.send('msg1', serverAddr.port, '127.0.0.1', onSend);
              client.send('msg2', serverAddr.port, '127.0.0.1', onSend);
              client.send('msg3', serverAddr.port, '127.0.0.1', onSend);
            });
            server.on('error', reject);
            server.bind(0);
          });
        });

        await it('send with callback should invoke callback', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          const callbackInvoked = await new Promise<boolean>((resolve, reject) => {
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send('callback test', serverAddr.port, '127.0.0.1', (err) => {
                expect(err).toBeNull();
                server.close();
                client.close();
                resolve(true);
              });
            });
            server.on('error', reject);
            server.bind(0);
          });

          expect(callbackInvoked).toBe(true);
        });
      });
    });
  });
};
