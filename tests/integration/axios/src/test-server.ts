// Minimal HTTP test server for axios integration tests.
// Replaces refs/axios/tests/setup/server.js — uses only node:http + node:zlib, no express.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { promisify } from 'node:util';
import { gzip, deflate, brotliCompress } from 'node:zlib';

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface TestServer {
  server: Server;
  port: number;
}

export async function startHTTPServer(handler?: RequestHandler): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!handler) { res.end(); return; }
      Promise.resolve(handler(req, res)).catch((err) => {
        if (!res.headersSent) { res.writeHead(500); res.end(String(err)); }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
    server.once('error', reject);
  });
}

export function stopHTTPServer(srv: TestServer): Promise<void> {
  return new Promise((resolve) => srv.server.close(() => resolve()));
}

/** Reads the full request body as a Buffer */
export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export const gzipAsync = promisify(gzip);
export const deflateAsync = promisify(deflate);
export const brotliAsync = promisify(brotliCompress);
