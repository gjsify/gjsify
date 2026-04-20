// SPDX-License-Identifier: MIT
// Ported from refs/socket.io/packages/socket.io/test/socket-middleware.ts
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
    multiplex: false,
    ...opts,
  });
}

export default async () => {
    await describe('socket middleware', async () => {
      await it('should call functions', async () => {
        const io = new Server(0, { transports: ['polling'] });
        const client = createClient(io);

        client.emit('join', 'woot');

        let run = 0;

        await new Promise<void>((resolve, reject) => {
          io.on('connection', socket => {
            socket.use((event, next) => {
              expect(event).toStrictEqual(['join', 'woot']);
              (event as string[]).unshift('wrap');
              run++;
              next();
            });
            socket.use((_event, next) => {
              expect(run).toBeGreaterThan(0);
              run++;
              next();
            });
            socket.on('wrap', (data1: string, data2: string) => {
              try {
                expect(data1).toBe('join');
                expect(data2).toBe('woot');
                expect(run).toBe(2);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          });
        });

        client.disconnect();
        io.close();
      });

      await it('should pass errors', async () => {
        const io = new Server(0, { transports: ['polling'] });
        const client = createClient(io);

        client.emit('join', 'woot');

        await new Promise<void>((resolve, reject) => {
          io.on('connection', socket => {
            socket.use((_event, next) => {
              next(new Error('Authentication error'));
            });
            socket.use((_event, _next) => {
              reject(new Error('second middleware should not run'));
            });
            socket.on('join', () => {
              reject(new Error('join handler should not run'));
            });
            socket.on('error', (err: Error) => {
              try {
                expect(err).toBeInstanceOf(Error);
                expect(err.message).toBe('Authentication error');
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          });
        });

        client.disconnect();
        io.close();
      });
    });
};
