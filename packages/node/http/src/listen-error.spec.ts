// Ported from refs/node-test/parallel/test-net-server-listen-handle.js
// Original: MIT license, Node.js contributors
// Tests that http.Server emits 'error' with code EADDRINUSE when port is busy.

import { describe, it, expect } from '@gjsify/unit';
import * as http from 'node:http';

export default async () => {

  await describe('http.Server listen error', async () => {

    await it('should emit error with EADDRINUSE when port is already in use', async () => {
      // First server binds a random port
      const server1 = http.createServer();
      const port = await new Promise<number>((resolve, reject) => {
        server1.on('error', reject);
        server1.listen(0, () => {
          const addr = server1.address() as { port: number };
          resolve(addr.port);
        });
      });

      try {
        // Second server tries to bind the same port — must emit 'error'
        const error = await new Promise<any>((resolve, reject) => {
          const server2 = http.createServer();
          server2.on('error', resolve);
          server2.on('listening', () => {
            server2.close();
            reject(new Error('Expected EADDRINUSE but server started successfully'));
          });
          server2.listen(port);
        });

        expect(error.code).toBe('EADDRINUSE');
        expect(error.syscall).toBe('listen');
        expect(typeof error.port).toBe('number');
        expect(error.port).toBe(port);
      } finally {
        server1.close();
      }
    });

    await it('should include address and port in error message', async () => {
      const server1 = http.createServer();
      const port = await new Promise<number>((resolve, reject) => {
        server1.on('error', reject);
        server1.listen(0, () => {
          const addr = server1.address() as { port: number };
          resolve(addr.port);
        });
      });

      try {
        const error = await new Promise<any>((resolve, reject) => {
          const server2 = http.createServer();
          server2.on('error', resolve);
          server2.on('listening', () => {
            server2.close();
            reject(new Error('Expected EADDRINUSE'));
          });
          server2.listen(port);
        });

        expect(error.message).toContain('EADDRINUSE');
        expect(error.message).toContain('listen');
      } finally {
        server1.close();
      }
    });

  });
};
