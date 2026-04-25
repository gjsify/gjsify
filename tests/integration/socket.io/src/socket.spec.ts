// SPDX-License-Identifier: MIT
// Ported from refs/socket.io/packages/socket.io/test/socket.ts
// Original: Copyright (c) Automattic. MIT License.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import type { AddressInfo } from 'node:net';

function getPort(io: Server): number {
  return (io.httpServer.address() as AddressInfo).port;
}

function createClient(io: Server, nsp: string = '/', opts?: any) {
  return ioc(`http://localhost:${getPort(io)}${nsp}`, {
    transports: ['polling', 'websocket'],
    ...opts,
  });
}

export default async () => {
  await describe('socket', async () => {

    await it('should receive events', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          s.on('random', (a, b, c) => {
            try {
              expect(a).toBe(1);
              expect(b).toBe('2');
              expect(c).toStrictEqual([3]);
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
          socket.emit('random', 1, '2', [3]);
        });
      });
    });

    await it('should receive message events through `send` (client→server)', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          s.on('message', (a) => {
            try {
              expect(a).toBe(1337);
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
          socket.send(1337);
        });
      });
    });

    await it('should handle null messages', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          s.on('message', (a) => {
            try {
              expect(a).toBeNull();
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
          socket.send(null);
        });
      });
    });

    await it('should emit events', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        socket.on('woot', (a) => {
          try {
            expect(a).toBe('tobi');
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        });
        io.on('connection', (s) => {
          s.emit('woot', 'tobi');
        });
      });
    });

    await it('should emit events with utf8 multibyte character', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);
      let i = 0;

      await new Promise<void>((resolve, reject) => {
        socket.on('hoot', (a) => {
          try {
            expect(a).toBe('utf8 — string');
            i++;
            if (i === 3) {
              resolve();
              socket.disconnect();
              io.close();
            }
          } catch (e) {
            reject(e);
            socket.disconnect();
            io.close();
          }
        });
        io.on('connection', (s) => {
          s.emit('hoot', 'utf8 — string');
          s.emit('hoot', 'utf8 — string');
          s.emit('hoot', 'utf8 — string');
        });
      });
    });

    await it('should not emit volatile event after regular event (ws)', async () => {
      const io = new Server(0, { transports: ['websocket'] });
      let counter = 0;

      io.on('connection', (s) => {
        s.emit('ev', 'data');
        s.volatile.emit('ev', 'data');
      });

      const socket = createClient(io, '/', { transports: ['websocket'] });
      socket.on('ev', () => { counter++; });

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          try {
            expect(counter).toBe(1);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        }, 200);
      });
    });

    await it('should emit volatile event (ws)', async () => {
      const io = new Server(0, { transports: ['websocket'] });
      let counter = 0;

      io.on('connection', (s) => {
        // Wait to make sure there are no packets being sent for opening the connection
        setTimeout(() => { s.volatile.emit('ev', 'data'); }, 20);
      });

      const socket = createClient(io, '/', { transports: ['websocket'] });
      socket.on('ev', () => { counter++; });

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          try {
            expect(counter).toBe(1);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        }, 200);
      });
    });

    await it('should emit only one consecutive volatile event (ws)', async () => {
      const io = new Server(0, { transports: ['websocket'] });
      let counter = 0;

      io.on('connection', (s) => {
        setTimeout(() => {
          s.volatile.emit('ev', 'data');
          s.volatile.emit('ev', 'data');
        }, 20);
      });

      const socket = createClient(io, '/', { transports: ['websocket'] });
      socket.on('ev', () => { counter++; });

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          try {
            expect(counter).toBe(1);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        }, 200);
      });
    });

    await it('should emit regular events after trying a failed volatile event (ws)', async () => {
      const io = new Server(0, { transports: ['websocket'] });
      let counter = 0;

      io.on('connection', (s) => {
        setTimeout(() => {
          s.emit('ev', 'data');
          s.volatile.emit('ev', 'data');
          s.emit('ev', 'data');
        }, 20);
      });

      const socket = createClient(io, '/', { transports: ['websocket'] });
      socket.on('ev', () => { counter++; });

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          try {
            expect(counter).toBe(2);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        }, 200);
      });
    });

    await it('should emit message events through `send` (server→client)', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        socket.on('message', (a) => {
          try {
            expect(a).toBe('a');
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        });
        io.on('connection', (s) => { s.send('a'); });
      });
    });

    await it('should receive event with callbacks', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          s.on('woot', (fn: (a: number, b: number) => void) => { fn(1, 2); });
          socket.emit('woot', (a: number, b: number) => {
            try {
              expect(a).toBe(1);
              expect(b).toBe(2);
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
        });
      });
    });

    await it('should receive all events emitted from namespaced client in order', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      let total = 0;

      await new Promise<void>((resolve, reject) => {
        io.of('/chat', (s) => {
          s.on('hi', (letter: string) => {
            total++;
            try {
              if (total === 2 && letter === 'b') {
                resolve();
                chat.disconnect();
                io.close();
              } else if (total === 1 && letter !== 'a') {
                throw new Error('events out of order');
              }
            } catch (e) {
              reject(e);
              chat.disconnect();
              io.close();
            }
          });
        });
        const chat = createClient(io, '/chat');
        chat.emit('hi', 'a');
        setTimeout(() => { chat.emit('hi', 'b'); }, 50);
      });
    });

    await it('should emit events with callbacks', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          socket.on('hi', (fn: () => void) => { fn(); });
          s.emit('hi', () => {
            try {
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
        });
      });
    });

    await it('should receive events with args and callback', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          s.on('woot', (a: number, b: number, fn: () => void) => {
            expect(a).toBe(1);
            expect(b).toBe(2);
            fn();
          });
          socket.emit('woot', 1, 2, () => {
            try {
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
        });
      });
    });

    await it('should emit events with args and callback', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          socket.on('hi', (a: number, b: number, fn: () => void) => {
            expect(a).toBe(1);
            expect(b).toBe(2);
            fn();
          });
          s.emit('hi', 1, 2, () => {
            try {
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
        });
      });
    });

    await it('should emit an event and wait for the acknowledgement', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', async (s) => {
          socket.on('hi', (a: number, b: number, fn: (v: number) => void) => {
            expect(a).toBe(1);
            expect(b).toBe(2);
            fn(3);
          });
          try {
            const val = await s.emitWithAck('hi', 1, 2);
            expect(val).toBe(3);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should have access to the client', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          try {
            expect(typeof s.client).toBe('object');
            expect(s.client).toBeDefined();
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should have access to the connection', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          try {
            expect(s.client.conn).toBeDefined();
            expect(s.conn).toBeDefined();
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should have access to the request', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          try {
            expect(s.client.request.headers).toBeDefined();
            expect(s.request.headers).toBeDefined();
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should see auth and EIO query in secondary namespace handshake', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const client1 = createClient(io);
      const client2 = createClient(io, '/connection2', {
        auth: { key1: 'aa', key2: '&=bb' },
      });

      await new Promise<void>((resolve, reject) => {
        io.on('connection', () => {});
        io.of('/connection2').on('connection', (s) => {
          try {
            expect(s.handshake.query.key1).toBeUndefined();
            expect(s.handshake.query.EIO).toBe('4');
            expect(s.handshake.auth.key1).toBe('aa');
            expect(s.handshake.auth.key2).toBe('&=bb');
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            client1.disconnect();
            client2.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should throw on reserved event', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          try {
            expect(() => s.emit('connect_error')).toThrow();
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            socket.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should leave all rooms after a middleware failure', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const client = createClient(io, '/');

      io.use((socket, next) => {
        socket.join('room1');
        next(new Error('nope'));
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect_error', () => {
          try {
            expect(io.of('/').adapter.rooms.size).toBe(0);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            client.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should not join rooms after disconnection', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const client = createClient(io, '/');

      await new Promise<void>((resolve, reject) => {
        io.on('connection', (socket) => {
          socket.disconnect();
          socket.join('room1');
        });
        client.on('disconnect', () => {
          try {
            expect(io.of('/').adapter.rooms.size).toBe(0);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            client.disconnect();
            io.close();
          }
        });
      });
    });

    await describe('onAny', async () => {
      await it('should call listener', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        clientSocket.emit('my-event', '123');

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            socket.onAny((event, arg1) => {
              try {
                expect(event).toBe('my-event');
                expect(arg1).toBe('123');
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });
          });
        });
      });

      await it('should prepend listener', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        clientSocket.emit('my-event', '123');

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            let count = 0;

            socket.onAny(() => {
              try {
                expect(count).toBe(2);
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });

            socket.prependAny(() => { expect(count++).toBe(1); });
            socket.prependAny(() => { expect(count++).toBe(0); });
          });
        });
      });

      await it('should remove listener', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        clientSocket.emit('my-event', '123');

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            const fail = () => reject(new Error('onAny fail listener should have been removed'));

            socket.onAny(fail);
            socket.offAny(fail);
            expect(socket.listenersAny.length).toBe(0);

            socket.onAny(() => {
              try {
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });
          });
        });
      });
    });

    await describe('onAnyOutgoing', async () => {
      await it('should call listener', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            socket.onAnyOutgoing((event, arg1) => {
              try {
                expect(event).toBe('my-event');
                expect(arg1).toBe('123');
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });
            socket.emit('my-event', '123');
          });
        });
      });

      await it('should call listener when broadcasting', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            socket.onAnyOutgoing((event, arg1) => {
              try {
                expect(event).toBe('my-event');
                expect(arg1).toBe('123');
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });
            io.emit('my-event', '123');
          });
        });
      });

      await it('should call listener when broadcasting binary data', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            socket.onAnyOutgoing((event, arg1) => {
              try {
                expect(event).toBe('my-event');
                expect(arg1).toBeInstanceOf(Uint8Array);
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });
            io.emit('my-event', Uint8Array.of(1, 2, 3));
          });
        });
      });

      await it('should prepend listener', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            let count = 0;

            socket.onAnyOutgoing(() => {
              try {
                expect(count).toBe(2);
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });

            socket.prependAnyOutgoing(() => { expect(count++).toBe(1); });
            socket.prependAnyOutgoing(() => { expect(count++).toBe(0); });
            socket.emit('my-event', '123');
          });
        });
      });

      await it('should remove listener', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const clientSocket = createClient(io, '/', { multiplex: false });

        await new Promise<void>((resolve, reject) => {
          io.on('connection', (socket) => {
            const fail = () => reject(new Error('onAnyOutgoing fail listener should have been removed'));

            socket.onAnyOutgoing(fail);
            socket.offAnyOutgoing(fail);
            expect(socket.listenersAnyOutgoing.length).toBe(0);

            socket.onAnyOutgoing(() => {
              try {
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                clientSocket.disconnect();
                io.close();
              }
            });
            socket.emit('my-event', '123');
          });
        });
      });

      await it('should disconnect all namespaces when calling disconnect(true)', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        io.of('/foo');
        io.of('/bar');

        const socket1 = createClient(io, '/', { transports: ['websocket'] });
        const socket2 = createClient(io, '/foo');
        const socket3 = createClient(io, '/bar');

        let disconnected = 0;

        await new Promise<void>((resolve, reject) => {
          io.of('/bar').on('connection', (socket) => {
            socket.disconnect(true);
          });

          const partialDone = () => {
            if (++disconnected === 3) {
              try {
                resolve();
              } catch (e) {
                reject(e);
              } finally {
                io.close();
              }
            }
          };

          socket1.on('disconnect', partialDone);
          socket2.on('disconnect', partialDone);
          socket3.on('disconnect', partialDone);
        });
      });
    });
  });
};
