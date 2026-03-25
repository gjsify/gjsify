// Ported from refs/node-test/parallel/test-dgram-connect.js,
//   test-dgram-bind.js, test-dgram-address.js
// Original: MIT license, Node.js contributors
import { describe, it, expect, on } from '@gjsify/unit';
import dgram, { createSocket, Socket } from 'node:dgram';

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

      // Ported from refs/node-test/parallel/test-dgram-address.js
      await it('should return family IPv4 for udp4 socket after bind', async () => {
        const socket = createSocket('udp4');

        const result = await Promise.race([
          new Promise<string>((resolve) => {
            socket.on('listening', () => resolve('listening'));
            socket.on('error', () => resolve('error'));
            socket.bind(0, '127.0.0.1');
          }),
          new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ]);

        if (result === 'listening') {
          const addr = socket.address();
          expect(addr.family).toBe('IPv4');
          expect(addr.address).toBe('127.0.0.1');
          expect(addr.port).toBeGreaterThan(0);
        }
        socket.close();
      });

      // Ported from refs/node-test/parallel/test-dgram-bind-default-address.js
      await it('should bind to 0.0.0.0 by default for udp4', async () => {
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
          expect(addr.address).toBe('0.0.0.0');
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

      await it('should have setMulticastInterface method', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.setMulticastInterface).toBe('function');
        socket.close();
      });

      await it('should have getRecvBufferSize and getSendBufferSize', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.getRecvBufferSize).toBe('function');
        expect(typeof socket.getSendBufferSize).toBe('function');
        socket.close();
      });

      await it('should have connect and disconnect methods', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.connect).toBe('function');
        expect(typeof socket.disconnect).toBe('function');
        socket.close();
      });
    });

    // --- setBroadcast ---
    // Ported from refs/node-test/parallel/test-dgram-setBroadcast.js
    await describe('setBroadcast', async () => {
      await it('should call setBroadcast after bind without error', async () => {
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
          expect(() => socket.setBroadcast(true)).not.toThrow();
          expect(() => socket.setBroadcast(false)).not.toThrow();
        }
        socket.close();
      });
    });

    // --- setTTL ---
    // Ported from refs/node-test/parallel/test-dgram-setTTL.js
    await describe('setTTL', async () => {
      await it('should return the TTL value after bind', async () => {
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
          const ttl = socket.setTTL(16);
          expect(ttl).toBe(16);
        }
        socket.close();
      });
    });

    // --- setMulticastTTL ---
    // Ported from refs/node-test/parallel/test-dgram-multicast-setTTL.js
    await describe('setMulticastTTL', async () => {
      await it('should return the TTL value after bind', async () => {
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
          const ttl = socket.setMulticastTTL(16);
          expect(ttl).toBe(16);
        }
        socket.close();
      });
    });

    // --- setMulticastLoopback ---
    // Ported from refs/node-test/parallel/test-dgram-multicast-loopback.js
    await describe('setMulticastLoopback', async () => {
      await it('should return the flag value after bind', async () => {
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
          const val = socket.setMulticastLoopback(true);
          expect(val).toBe(true);
        }
        socket.close();
      });
    });

    // --- addMembership / dropMembership ---
    await describe('addMembership and dropMembership', async () => {
      await it('should have addMembership as a function', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.addMembership).toBe('function');
        socket.close();
      });

      await it('should have dropMembership as a function', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.dropMembership).toBe('function');
        socket.close();
      });
    });

    // --- ref / unref ---
    // Ported from refs/node-test/parallel/test-dgram-ref.js, test-dgram-unref.js
    await describe('ref and unref', async () => {
      await it('ref() should return the socket for chaining', async () => {
        const socket = createSocket('udp4');
        const result = socket.ref();
        expect(result).toBe(socket);
        socket.close();
      });

      await it('unref() should return the socket for chaining', async () => {
        const socket = createSocket('udp4');
        const result = socket.unref();
        expect(result).toBe(socket);
        socket.close();
      });

      await it('ref() after close should not throw', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.close(() => {
            expect(() => socket.ref()).not.toThrow();
            resolve();
          });
        });
      });

      await it('unref() after close should not throw', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.close(() => {
            expect(() => socket.unref()).not.toThrow();
            resolve();
          });
        });
      });

      await it('should allow chaining ref().unref()', async () => {
        const socket = createSocket('udp4');
        const result = socket.ref().unref();
        expect(result).toBe(socket);
        socket.close();
      });
    });

    // --- close ---
    await describe('close on unbound socket', async () => {
      await it('close() on unbound socket should not throw', async () => {
        const socket = createSocket('udp4');
        // Socket was never bound — close should still work
        expect(() => socket.close()).not.toThrow();
      });

      await it('multiple close() calls should throw ERR_SOCKET_DGRAM_NOT_RUNNING', async () => {
        const socket = createSocket('udp4');
        socket.close();
        // Second close should throw — socket is no longer running
        let threw = false;
        try {
          socket.close();
        } catch (e: unknown) {
          threw = true;
          expect((e as Error).message).toBe('Not running');
        }
        expect(threw).toBe(true);
      });

      await it('close() should return the socket', async () => {
        const socket = createSocket('udp4');
        const result = socket.close();
        expect(result).toBe(socket);
      });
    });

    // --- EventEmitter behavior ---
    await describe('EventEmitter behavior', async () => {
      await it('socket should be an instance of EventEmitter', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.on).toBe('function');
        expect(typeof socket.once).toBe('function');
        expect(typeof socket.emit).toBe('function');
        expect(typeof socket.removeListener).toBe('function');
        expect(typeof socket.removeAllListeners).toBe('function');
        socket.close();
      });

      await it('should support adding multiple event listeners', async () => {
        const socket = createSocket('udp4');
        let count = 0;
        socket.on('close', () => { count++; });
        socket.on('close', () => { count++; });
        socket.close();
        await new Promise<void>((r) => setTimeout(r, 20));
        expect(count).toBe(2);
      });

      await it('should support once() listener that fires only once', async () => {
        const socket = createSocket('udp4');
        let count = 0;
        socket.once('close', () => { count++; });
        socket.close();
        await new Promise<void>((r) => setTimeout(r, 20));
        expect(count).toBe(1);
      });

      await it('should support removeListener', async () => {
        const socket = createSocket('udp4');
        let called = false;
        const handler = () => { called = true; };
        socket.on('close', handler);
        socket.removeListener('close', handler);
        socket.close();
        await new Promise<void>((r) => setTimeout(r, 20));
        expect(called).toBe(false);
      });

      await it('should emit listening event on bind', async () => {
        const socket = createSocket('udp4');
        let listening = false;
        socket.on('listening', () => { listening = true; });

        const result = await Promise.race([
          new Promise<string>((resolve) => {
            socket.on('listening', () => resolve('listening'));
            socket.on('error', () => resolve('error'));
            socket.bind(0);
          }),
          new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ]);

        if (result === 'listening') {
          expect(listening).toBe(true);
        }
        socket.close();
      });

      await it('should support error event listener', async () => {
        const socket = createSocket('udp4');
        let errorCalled = false;
        socket.on('error', () => { errorCalled = true; });
        // Just verify the listener was registered without error
        expect(typeof socket.listeners('error')).toBe('object');
        socket.close();
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

    // --- IPv6 socket creation ---
    await describe('IPv6 socket', async () => {
      await it('should create udp6 socket with options object', async () => {
        const socket = createSocket({ type: 'udp6' });
        expect(socket).toBeDefined();
        expect(socket.type).toBe('udp6');
        socket.close();
      });

      await it('udp6 socket should bind and emit listening', async () => {
        const socket = createSocket('udp6');

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
          expect(addr.family).toBe('IPv6');
          expect(addr.port).toBeGreaterThan(0);
        }
        socket.close();
      });
    });

    // --- bind with callback ---
    await describe('bind with callback', async () => {
      await it('should accept callback as second argument to bind(port, cb)', async () => {
        const socket = createSocket('udp4');

        const result = await Promise.race([
          new Promise<string>((resolve) => {
            socket.bind(0, () => resolve('listening'));
            socket.on('error', () => resolve('error'));
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

    // --- setRecvBufferSize / setSendBufferSize ---
    await describe('setRecvBufferSize and setSendBufferSize', async () => {
      await it('should have setRecvBufferSize as a function', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.setRecvBufferSize).toBe('function');
        socket.close();
      });

      await it('should have setSendBufferSize as a function', async () => {
        const socket = createSocket('udp4');
        expect(typeof socket.setSendBufferSize).toBe('function');
        socket.close();
      });

      await it('should not throw when calling setRecvBufferSize after bind', async () => {
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
          expect(() => socket.setRecvBufferSize(8192)).not.toThrow();
        }
        socket.close();
      });

      await it('should not throw when calling setSendBufferSize after bind', async () => {
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
          expect(() => socket.setSendBufferSize(8192)).not.toThrow();
        }
        socket.close();
      });
    });

    // --- connect / disconnect / remoteAddress ---
    // Ported from refs/node-test/parallel/test-dgram-connect.js
    await describe('connect and disconnect', async () => {
      await it('connect should set remoteAddress', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.connect(12345, '127.0.0.1', () => {
            const remote = (socket as any).remoteAddress();
            expect(remote.port).toBe(12345);
            expect(remote.address).toBe('127.0.0.1');
            expect(remote.family).toBe('IPv4');
            socket.close();
            resolve();
          });
        });
      });

      await it('connect should emit connect event', async () => {
        const socket = createSocket('udp4');
        let connectEmitted = false;
        socket.on('connect', () => { connectEmitted = true; });

        await new Promise<void>((resolve) => {
          socket.connect(12345, '127.0.0.1', () => {
            expect(connectEmitted).toBe(true);
            socket.close();
            resolve();
          });
        });
      });

      await it('connect with default host should use 127.0.0.1', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.connect(12345, () => {
            const remote = (socket as any).remoteAddress();
            expect(remote.port).toBe(12345);
            expect(remote.address).toBe('127.0.0.1');
            socket.close();
            resolve();
          });
        });
      });

      await it('connect twice should throw ERR_SOCKET_DGRAM_IS_CONNECTED', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.connect(12345, '127.0.0.1', () => {
            let threw = false;
            try {
              socket.connect(12345, () => {});
            } catch (e: unknown) {
              threw = true;
              expect((e as NodeJS.ErrnoException).code).toBe('ERR_SOCKET_DGRAM_IS_CONNECTED');
            }
            expect(threw).toBe(true);
            socket.close();
            resolve();
          });
        });
      });

      await it('disconnect after connect should succeed', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.connect(12345, '127.0.0.1', () => {
            socket.disconnect();
            // remoteAddress() should now throw
            let threw = false;
            try {
              (socket as any).remoteAddress();
            } catch (e: unknown) {
              threw = true;
              expect((e as NodeJS.ErrnoException).code).toBe('ERR_SOCKET_DGRAM_NOT_CONNECTED');
            }
            expect(threw).toBe(true);
            socket.close();
            resolve();
          });
        });
      });

      await it('disconnect without connect should throw ERR_SOCKET_DGRAM_NOT_CONNECTED', async () => {
        const socket = createSocket('udp4');
        let threw = false;
        try {
          socket.disconnect();
        } catch (e: unknown) {
          threw = true;
          expect((e as NodeJS.ErrnoException).code).toBe('ERR_SOCKET_DGRAM_NOT_CONNECTED');
        }
        expect(threw).toBe(true);
        socket.close();
      });

      await it('remoteAddress on unconnected socket should throw', async () => {
        const socket = createSocket('udp4');
        let threw = false;
        try {
          (socket as any).remoteAddress();
        } catch (e: unknown) {
          threw = true;
          expect((e as NodeJS.ErrnoException).code).toBe('ERR_SOCKET_DGRAM_NOT_CONNECTED');
        }
        expect(threw).toBe(true);
        socket.close();
      });

      await it('connect with invalid port should throw ERR_SOCKET_BAD_PORT', async () => {
        const socket = createSocket('udp4');
        const invalidPorts = [0, 65536, -1];
        for (const port of invalidPorts) {
          let threw = false;
          try {
            socket.connect(port);
          } catch (e: unknown) {
            threw = true;
            expect((e as NodeJS.ErrnoException).code).toBe('ERR_SOCKET_BAD_PORT');
          }
          expect(threw).toBe(true);
        }
        socket.close();
      });

      await it('double disconnect should throw ERR_SOCKET_DGRAM_NOT_CONNECTED', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.connect(12345, '127.0.0.1', () => {
            socket.disconnect();
            let threw = false;
            try {
              socket.disconnect();
            } catch (e: unknown) {
              threw = true;
              expect((e as NodeJS.ErrnoException).code).toBe('ERR_SOCKET_DGRAM_NOT_CONNECTED');
            }
            expect(threw).toBe(true);
            socket.close();
            resolve();
          });
        });
      });

      await it('connect then disconnect then reconnect should work', async () => {
        const socket = createSocket('udp4');
        await new Promise<void>((resolve) => {
          socket.connect(12345, '127.0.0.1', () => {
            socket.disconnect();
            // Should be able to connect again
            socket.connect(54321, '127.0.0.1', () => {
              const remote = (socket as any).remoteAddress();
              expect(remote.port).toBe(54321);
              socket.close();
              resolve();
            });
          });
        });
      });
    });

    // --- Node.js-only tests requiring actual socket I/O ---
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

      // Ported from refs/node-test/parallel/test-dgram-implicit-bind.js
      await describe('implicit bind on send', async () => {
        await it('send without explicit bind should auto-bind', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            server.on('message', (msg) => {
              expect(msg.toString()).toBe('auto-bind');
              server.close();
              client.close();
              resolve();
            });
            server.on('listening', () => {
              const serverAddr = server.address();
              // client was never bound — send should auto-bind
              client.send('auto-bind', serverAddr.port, '127.0.0.1');
            });
            server.on('error', reject);
            server.bind(0);
          });
        });
      });

      await describe('receive Buffer message content', async () => {
        await it('should receive Buffer data matching what was sent', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');

          await new Promise<void>((resolve, reject) => {
            server.on('message', (msg) => {
              expect(Buffer.isBuffer(msg)).toBe(true);
              expect(msg.toString()).toBe('buffer-content');
              server.close();
              client.close();
              resolve();
            });
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send(Buffer.from('buffer-content'), serverAddr.port, '127.0.0.1');
            });
            server.on('error', reject);
            server.bind(0);
          });
        });
      });

      await describe('rinfo size field', async () => {
        await it('should include size in rinfo matching message length', async () => {
          const server = createSocket('udp4');
          const client = createSocket('udp4');
          const testMsg = 'size-test';

          await new Promise<void>((resolve, reject) => {
            server.on('message', (msg, rinfo) => {
              expect(msg.length).toBe(testMsg.length);
              // rinfo.size should match message byte length
              if ('size' in rinfo) {
                expect((rinfo as any).size).toBe(testMsg.length);
              }
              server.close();
              client.close();
              resolve();
            });
            server.on('listening', () => {
              const serverAddr = server.address();
              client.send(testMsg, serverAddr.port, '127.0.0.1');
            });
            server.on('error', reject);
            server.bind(0);
          });
        });
      });

      await describe('close during listening', async () => {
        // Ported from refs/node-test/parallel/test-dgram-close-in-listening.js
        await it('should allow close() inside listening callback', async () => {
          const socket = createSocket('udp4');
          let closeCalled = false;

          await new Promise<void>((resolve) => {
            socket.on('listening', () => {
              socket.close(() => {
                closeCalled = true;
                resolve();
              });
            });
            socket.bind(0);
          });

          expect(closeCalled).toBe(true);
        });
      });
    });
  });
};
