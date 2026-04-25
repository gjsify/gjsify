// SPDX-License-Identifier: MIT
// Ported from refs/socket.io/packages/socket.io/test/namespaces.ts
// Original: Copyright (c) Automattic. MIT License.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Server, Namespace, Socket } from 'socket.io';
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
  await describe('namespaces', async () => {
    await it('should be accessible through .sockets', async () => {
      // new Server() without a port never binds, so engine is not initialized — do not call io.close()
      const io = new Server();
      expect(io.sockets).toBeInstanceOf(Namespace);
    });

    await it('should be aliased', async () => {
      // new Server() without a port never binds, so engine is not initialized — do not call io.close()
      const io = new Server();
      expect(typeof io.use).toBe('function');
      expect(typeof io.to).toBe('function');
      expect(typeof io['in']).toBe('function');
      expect(typeof io.emit).toBe('function');
      expect(typeof io.send).toBe('function');
      expect(typeof io.write).toBe('function');
      expect(typeof io.allSockets).toBe('function');
      expect(typeof io.compress).toBe('function');
    });

    await it('should return an immutable broadcast operator', async () => {
      // new Server() without a port never binds, so engine is not initialized — do not call io.close()
      const io = new Server();
      const operator = io.local.to(['room1', 'room2']).except('room3');
      operator.compress(true).emit('hello');
      operator.volatile.emit('hello');
      operator.to('room4').emit('hello');
      operator.except('room5').emit('hello');
      io.to('room6').emit('hello');
      // @ts-ignore — rooms/exceptRooms/flags are internal
      const rooms = [...(operator.rooms as Set<string>)];
      // @ts-ignore
      const exceptRooms = [...(operator.exceptRooms as Set<string>)];
      // @ts-ignore
      const flags = operator.flags as Record<string, unknown>;
      expect(rooms).toContain('room1');
      expect(rooms).toContain('room2');
      expect(exceptRooms).toContain('room3');
      expect(flags).toStrictEqual({ local: true });
    });

    await it('should automatically connect', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => {
          socket.disconnect();
          io.close(() => resolve());
        });
        socket.on('connect_error', reject);
      });
    });

    await it('should fire a `connection` event', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const clientSocket = createClient(io);
      await new Promise<void>((resolve, reject) => {
        io.on('connection', (socket) => {
          try {
            expect(socket).toBeInstanceOf(Socket);
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            clientSocket.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should fire a `connect` event', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const clientSocket = createClient(io);
      await new Promise<void>((resolve, reject) => {
        io.on('connect', (socket) => {
          try {
            expect(socket).toBeInstanceOf(Socket);
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            clientSocket.disconnect();
            io.close();
          }
        });
      });
    });

    await it('should work with many sockets', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      io.of('/chat');
      io.of('/news');
      const chat = createClient(io, '/chat');
      const news = createClient(io, '/news');
      await new Promise<void>((resolve, reject) => {
        let total = 2;
        const done = () => {
          if (!--total) {
            chat.disconnect();
            news.disconnect();
            io.close(() => resolve());
          }
        };
        chat.on('connect', done);
        news.on('connect', done);
        chat.on('connect_error', reject);
        news.on('connect_error', reject);
      });
    });

    await it('should be able to equivalently start with "" or "/" on server', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const c1 = createClient(io, '/');
      const c2 = createClient(io, '/abc');
      await new Promise<void>((resolve) => {
        let total = 2;
        const done = () => {
          if (!--total) {
            c1.disconnect();
            c2.disconnect();
            io.close(() => resolve());
          }
        };
        io.of('').on('connection', done);
        io.of('abc').on('connection', done);
      });
    });

    await it('should be equivalent for "" and "/" on client', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const c1 = createClient(io, '');
      await new Promise<void>((resolve, reject) => {
        io.of('/').on('connection', () => {
          c1.disconnect();
          io.close(() => resolve());
        });
        c1.on('connect_error', reject);
      });
    });

    await it('should work with `of` and many sockets', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const chat = createClient(io, '/chat');
      const news = createClient(io, '/news');
      await new Promise<void>((resolve, reject) => {
        let total = 2;
        const onConn = (socket: Socket) => {
          try {
            expect(socket).toBeInstanceOf(Socket);
            if (!--total) {
              chat.disconnect();
              news.disconnect();
              io.close(() => resolve());
            }
          } catch (e) {
            reject(e as Error);
          }
        };
        io.of('/news').on('connection', onConn);
        io.of('/news').on('connection', onConn);
        news.on('connect_error', reject);
      });
    });

    await it('should disconnect upon transport disconnection', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const chat = createClient(io, '/chat');
      const news = createClient(io, '/news');
      await new Promise<void>((resolve, reject) => {
        let total = 2;
        let totald = 2;
        let chatSocket: Socket | null = null;

        const onDisconnect = () => {
          if (!--totald) {
            io.close(() => resolve());
          }
        };

        io.of('/news', (socket) => {
          socket.on('disconnect', onDisconnect);
          if (!--total && chatSocket) chatSocket.disconnect(true);
        });
        io.of('/chat', (socket) => {
          chatSocket = socket;
          socket.on('disconnect', onDisconnect);
          if (!--total && chatSocket) chatSocket.disconnect(true);
        });

        chat.on('connect_error', reject);
        news.on('connect_error', reject);
      });
    });

    await it('should fire a `disconnecting` event just before leaving all rooms', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io);
      await new Promise<void>((resolve, reject) => {
        io.on('connection', (s) => {
          s.join('a');
          setTimeout(() => s.disconnect(), 0);

          let total = 2;
          s.on('disconnecting', () => {
            try {
              expect(s.rooms.has(s.id)).toBe(true);
              expect(s.rooms.has('a')).toBe(true);
              total--;
            } catch (e) {
              reject(e as Error);
            }
          });
          s.on('disconnect', () => {
            try {
              expect(s.rooms.size).toBe(0);
              if (!--total) {
                socket.disconnect();
                io.close(() => resolve());
              }
            } catch (e) {
              reject(e as Error);
            }
          });
        });
      });
    });

    await it('should return error connecting to non-existent namespace', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket = createClient(io, '/doesnotexist');
      await new Promise<void>((resolve, reject) => {
        socket.on('connect_error', (err: Error) => {
          try {
            expect(err.message).toBe('Invalid namespace');
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            io.close();
          }
        });
        socket.on('connect', () => reject(new Error('should not connect')));
      });
    });

    await it('should not reuse same-namespace connections', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const clientSocket1 = createClient(io);
      const clientSocket2 = createClient(io);
      await new Promise<void>((resolve) => {
        let connections = 0;
        io.on('connection', () => {
          connections++;
          if (connections === 2) {
            clientSocket1.disconnect();
            clientSocket2.disconnect();
            io.close(() => resolve());
          }
        });
      });
    });

    await it('should find all clients in a namespace', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const chatSids: string[] = [];
      let otherSid: string | null = null;

      const c1 = createClient(io, '/chat');
      const c2 = createClient(io, '/chat', { forceNew: true });
      const c3 = createClient(io, '/other', { forceNew: true });

      await new Promise<void>((resolve, reject) => {
        let total = 3;

        const getSockets = async () => {
          try {
            const sids = await io.of('/chat').allSockets();
            expect(sids.has(chatSids[0]!)).toBe(true);
            expect(sids.has(chatSids[1]!)).toBe(true);
            expect(sids.has(otherSid!)).toBe(false);
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            c1.disconnect();
            c2.disconnect();
            c3.disconnect();
            io.close();
          }
        };

        io.of('/chat').on('connection', (socket) => {
          chatSids.push(socket.id);
          if (!--total) getSockets();
        });
        io.of('/other').on('connection', (socket) => {
          otherSid = socket.id;
          if (!--total) getSockets();
        });
      });
    });

    await it('should find all clients in a namespace room', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      let chatFooSid: string | null = null;
      let chatBarSid: string | null = null;
      let otherSid: string | null = null;

      const c1 = createClient(io, '/chat');
      const c2 = createClient(io, '/chat', { forceNew: true });
      const c3 = createClient(io, '/other', { forceNew: true });

      await new Promise<void>((resolve, reject) => {
        let chatIndex = 0;
        let total = 3;

        const getSockets = async () => {
          try {
            const sids = await io.of('/chat').in('foo').allSockets();
            expect(sids.has(chatFooSid!)).toBe(true);
            expect(sids.has(chatBarSid!)).toBe(false);
            expect(sids.has(otherSid!)).toBe(false);
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            c1.disconnect();
            c2.disconnect();
            c3.disconnect();
            io.close();
          }
        };

        io.of('/chat').on('connection', (socket) => {
          if (chatIndex++) {
            socket.join('foo');
            chatFooSid = socket.id;
          } else {
            socket.join('bar');
            chatBarSid = socket.id;
          }
          if (!--total) getSockets();
        });
        io.of('/other').on('connection', (socket) => {
          socket.join('foo');
          otherSid = socket.id;
          if (!--total) getSockets();
        });
      });
    });

    await it('should find all clients across namespace rooms', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      let chatFooSid: string | null = null;
      let chatBarSid: string | null = null;
      let otherSid: string | null = null;

      const c1 = createClient(io, '/chat');
      const c2 = createClient(io, '/chat', { forceNew: true });
      const c3 = createClient(io, '/other', { forceNew: true });

      await new Promise<void>((resolve, reject) => {
        let chatIndex = 0;
        let total = 3;

        const getSockets = async () => {
          try {
            const sids = await io.of('/chat').allSockets();
            expect(sids.has(chatFooSid!)).toBe(true);
            expect(sids.has(chatBarSid!)).toBe(true);
            expect(sids.has(otherSid!)).toBe(false);
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            c1.disconnect();
            c2.disconnect();
            c3.disconnect();
            io.close();
          }
        };

        io.of('/chat').on('connection', (socket) => {
          if (chatIndex++) {
            socket.join('foo');
            chatFooSid = socket.id;
          } else {
            socket.join('bar');
            chatBarSid = socket.id;
          }
          if (!--total) getSockets();
        });
        io.of('/other').on('connection', (socket) => {
          socket.join('foo');
          otherSid = socket.id;
          if (!--total) getSockets();
        });
      });
    });

    await it('should emit volatile event', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      let counter = 0;

      io.of('/chat').on('connection', () => {
        setTimeout(() => {
          io.of('/chat').volatile.emit('ev', 'data');
        }, 100);
      });

      const socket = createClient(io, '/chat');
      socket.on('ev', () => { counter++; });

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          try {
            expect(counter).toBe(1);
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            socket.disconnect();
            io.close();
          }
        }, 500);
      });
    });

    await it('should throw on reserved event', async () => {
      // new Server() without a port never binds, so engine is not initialized — do not call io.close()
      const io = new Server();
      expect(() => (io as any).emit('connect')).toThrow(/"connect" is a reserved event name/);
    });

    await it('should exclude a specific socket when emitting', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const socket1 = createClient(io);
      const socket2 = createClient(io);
      await new Promise<void>((resolve, reject) => {
        socket2.on('a', () => reject(new Error('should not happen')));
        socket1.on('a', () => {
          socket1.disconnect();
          socket2.disconnect();
          io.close(() => resolve());
        });
        socket2.on('connect', () => {
          if (socket2.id) io.except(socket2.id).emit('a');
        });
      });
    });

    await it('should exclude a specific socket when emitting (in a namespace)', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const nsp = io.of('/nsp');
      const socket1 = createClient(io, '/nsp');
      const socket2 = createClient(io, '/nsp');
      await new Promise<void>((resolve, reject) => {
        socket2.on('a', () => reject(new Error('should not happen')));
        socket1.on('a', () => {
          socket1.disconnect();
          socket2.disconnect();
          io.close(() => resolve());
        });
        socket2.on('connect', () => {
          if (socket2.id) nsp.except(socket2.id).emit('a');
        });
      });
    });

    await it('should exclude a specific room when emitting', async () => {
      const io = new Server(0, { transports: ['polling', 'websocket'] });
      const nsp = io.of('/nsp');
      const socket1 = createClient(io, '/nsp');
      const socket2 = createClient(io, '/nsp');
      await new Promise<void>((resolve, reject) => {
        socket1.on('a', () => {
          socket1.disconnect();
          socket2.disconnect();
          io.close(() => resolve());
        });
        socket2.on('a', () => reject(new Error('should not happen')));

        nsp.on('connection', (socket) => {
          socket.on('broadcast', () => {
            socket.join('room1');
            nsp.except('room1').emit('a');
          });
        });

        socket2.emit('broadcast');
      });
    });

    await it("should emit a 'new_namespace' event", async () => {
      // new Server() without a port never binds, so engine is not initialized — do not call io.close()
      const io = new Server();
      await new Promise<void>((resolve, reject) => {
        io.on('new_namespace', (namespace) => {
          try {
            expect(namespace.name).toBe('/nsp');
            resolve();
          } catch (e) {
            reject(e as Error);
          }
        });
        io.of('/nsp');
      });
    });

    await describe('dynamic namespaces', async () => {
      await it('should allow connections to dynamic namespaces with a regex', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const socket = createClient(io, '/dynamic-101');

        await new Promise<void>((resolve, reject) => {
          let remaining = 4;
          const partialDone = () => {
            if (!--remaining) {
              socket.disconnect();
              io.close(() => resolve());
            }
          };

          const dynamicNsp = io
            .of(/^\/dynamic-\d+$/)
            .on('connect', (s) => {
              try {
                expect(s.nsp.name).toBe('/dynamic-101');
                dynamicNsp.emit('hello', 1, '2', { 3: '4' });
                partialDone();
              } catch (e) {
                reject(e as Error);
              }
            })
            .use((_s, next) => { next(); partialDone(); });

          socket.on('connect_error', (err: Error) => reject(new Error(`unexpected error: ${err.message}`)));
          socket.on('connect', partialDone);
          socket.on('hello', (a: unknown, b: unknown, c: unknown) => {
            try {
              expect(a).toBe(1);
              expect(b).toBe('2');
              expect(c).toStrictEqual({ 3: '4' });
              partialDone();
            } catch (e) {
              reject(e as Error);
            }
          });
        });
      });

      await it('should allow connections to dynamic namespaces with a function', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const socket = createClient(io, '/dynamic-101');

        io.of((name, _query, next) => next(null, '/dynamic-101' === name));

        await new Promise<void>((resolve, reject) => {
          socket.on('connect', () => {
            socket.disconnect();
            io.close(() => resolve());
          });
          socket.on('connect_error', reject);
        });
      });

      await it('should disallow connections when no dynamic namespace matches', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const socket = createClient(io, '/abc');
        io.of(/^\/dynamic-\d+$/);
        io.of((name, _query, next) => next(null, '/dynamic-101' === name));

        await new Promise<void>((resolve, reject) => {
          socket.on('connect_error', (err: Error) => {
            try {
              expect(err.message).toBe('Invalid namespace');
              resolve();
            } catch (e) {
              reject(e as Error);
            } finally {
              io.close();
            }
          });
          socket.on('connect', () => reject(new Error('should not connect')));
        });
      });

      await it("should emit a 'new_namespace' event for a dynamic namespace", async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        io.of(/^\/dynamic-\d+$/);
        const socket = createClient(io, '/dynamic-101');

        await new Promise<void>((resolve, reject) => {
          io.on('new_namespace', (namespace) => {
            try {
              expect(namespace.name).toBe('/dynamic-101');
              resolve();
            } catch (e) {
              reject(e as Error);
            } finally {
              socket.disconnect();
              io.close();
            }
          });
        });
      });

      await it('should handle race conditions with dynamic namespaces (#4136)', async () => {
        const io = new Server(0, { transports: ['polling', 'websocket'] });
        const counters = { connected: 0, created: 0, events: 0 };
        const buffer: Array<(err: Error | null, allow: boolean) => void> = [];

        io.on('new_namespace', () => { counters.created++; });

        const one = createClient(io, '/dynamic-101');
        const two = createClient(io, '/dynamic-101');

        await new Promise<void>((resolve, reject) => {
          const handler = () => {
            if (++counters.events === 2) {
              try {
                expect(counters.created).toBe(1);
                resolve();
              } catch (e) {
                reject(e as Error);
              } finally {
                one.disconnect();
                two.disconnect();
                io.close();
              }
            }
          };

          io.of((_name, _query, next) => {
            buffer.push(next as any);
            if (buffer.length === 2) buffer.forEach((n) => n(null, true));
          }).on('connection', () => {
            if (++counters.connected === 2) io.of('/dynamic-101').emit('message');
          });

          one.on('message', handler);
          two.on('message', handler);
        });
      });
    });
  });
};
