// SPDX-License-Identifier: MIT
// Ported from refs/socket.io/packages/socket.io/test/socket-timeout.ts
// Original: Copyright (c) socket.io contributors. MIT.
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
    transports: ['polling'],
    ...opts,
  });
}

export default async () => {
    await describe('socket timeout', async () => {
      await it('should timeout if the client does not acknowledge the event', async () => {
        const io = new Server(0, { transports: ['polling'] });
        const client = createClient(io);

        await new Promise<void>((resolve, reject) => {
          io.on('connection', socket => {
            socket.timeout(200).emit('unknown', (err: Error) => {
              try {
                expect(err).toBeInstanceOf(Error);
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
      });

      await it('should not timeout if the client does acknowledge the event', async () => {
        const io = new Server(0, { transports: ['polling'] });
        const client = createClient(io);

        client.on('echo', (arg: number, cb: (v: number) => void) => {
          cb(arg);
        });

        await new Promise<void>((resolve, reject) => {
          io.on('connection', socket => {
            socket.timeout(1000).emit('echo', 42, (err: Error | null, value: number) => {
              try {
                expect(err).toBeFalsy();
                expect(value).toBe(42);
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
      });

      await it('should timeout if the client does not acknowledge the event (promise)', async () => {
        const io = new Server(0, { transports: ['polling'] });
        const client = createClient(io);

        await new Promise<void>((resolve, reject) => {
          io.on('connection', async socket => {
            try {
              await socket.timeout(200).emitWithAck('unknown');
              reject(new Error('should have timed out'));
            } catch (err) {
              expect(err).toBeInstanceOf(Error);
              resolve();
            } finally {
              client.disconnect();
              io.close();
            }
          });
        });
      });

      await it('should not timeout if the client does acknowledge the event (promise)', async () => {
        const io = new Server(0, { transports: ['polling'] });
        const client = createClient(io);

        client.on('echo', (arg: number, cb: (v: number) => void) => {
          cb(arg);
        });

        await new Promise<void>((resolve, reject) => {
          io.on('connection', async socket => {
            try {
              const value = await socket.timeout(1000).emitWithAck('echo', 42);
              expect(value).toBe(42);
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              client.disconnect();
              io.close();
            }
          });
        });
      });
    });
};
