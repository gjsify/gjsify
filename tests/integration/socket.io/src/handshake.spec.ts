// SPDX-License-Identifier: MIT
// Ported from refs/socket.io/packages/socket.io/test/handshake.ts
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
  const port = getPort(io);
  return ioc(`http://localhost:${port}${nsp}`, {
    transports: ['polling'],
    ...opts,
  });
}

function cleanup(io: Server, ...clients: ReturnType<typeof ioc>[]) {
  clients.forEach(c => c.disconnect());
  io.close();
}

export default async () => {
    await describe('socket.io handshake — CORS headers', async () => {
      await it('should send Access-Control-Allow-xxx headers on OPTIONS request', async () => {
        const io = new Server(0, {
          cors: {
            origin: 'http://localhost:54023',
            methods: ['GET', 'POST'],
            allowedHeaders: ['content-type'],
            credentials: true,
          },
          transports: ['polling'],
        });

        const port = getPort(io);
        const resp = await fetch(`http://localhost:${port}/socket.io/default/`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'http://localhost:54023',
          },
        }).then(r => ({ status: r.status, headers: r.headers }));

        io.close();

        expect(resp.status).toBe(204);
        expect(resp.headers.get('access-control-allow-origin')).toBe('http://localhost:54023');
        expect(resp.headers.get('access-control-allow-credentials')).toBe('true');
      });

      await it('should send Access-Control-Allow-xxx headers on GET request', async () => {
        const io = new Server(0, {
          cors: {
            origin: 'http://localhost:54024',
            methods: ['GET', 'POST'],
            allowedHeaders: ['content-type'],
            credentials: true,
          },
          transports: ['polling'],
        });

        const port = getPort(io);
        const resp = await fetch(
          `http://localhost:${port}/socket.io/default/?transport=polling&EIO=4`,
          { headers: { Origin: 'http://localhost:54024' } }
        ).then(r => ({ status: r.status, headers: r.headers }));

        io.close();

        expect(resp.status).toBe(200);
        expect(resp.headers.get('access-control-allow-origin')).toBe('http://localhost:54024');
        expect(resp.headers.get('access-control-allow-credentials')).toBe('true');
      });

      await it('should allow request if allowRequest returns true', async () => {
        const io = new Server(0, {
          allowRequest: (_req: any, callback: any) => callback(null, true),
          transports: ['polling'],
        });

        const port = getPort(io);
        const resp = await fetch(
          `http://localhost:${port}/socket.io/default/?transport=polling&EIO=4`
        );
        io.close();

        expect(resp.status).toBe(200);
      });

      await it('should disallow request if allowRequest returns false', async () => {
        const io = new Server(0, {
          allowRequest: (_req: any, callback: any) => callback(null, false),
          transports: ['polling'],
        });

        const port = getPort(io);
        const resp = await fetch(
          `http://localhost:${port}/socket.io/default/?transport=polling&EIO=4`,
          { headers: { origin: 'http://foo.example' } }
        );
        io.close();

        expect(resp.status).toBe(403);
      });
    });
};
