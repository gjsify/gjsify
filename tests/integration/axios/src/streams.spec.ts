// Ported from refs/axios/tests/unit/adapters/http.test.js (streams + buffers tests)
// Original: MIT, axios contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect, on } from '@gjsify/unit';
import axios from 'axios';
import { Readable } from 'node:stream';
import { startHTTPServer, stopHTTPServer, readBody } from './test-server.js';

function collectStream(readable: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async () => {
  await describe('axios: streams', async () => {
    // responseType: 'stream' requires the HTTP adapter; the XHR adapter on GJS
    // returns the body as text/arraybuffer and cannot return a Node.js Readable.
    await on('Node.js', async () => {
      await it('responseType: "stream" returns a Readable with correct data', async () => {
        const payload = 'stream response payload';
        const srv = await startHTTPServer((req, res) => {
          res.end(payload);
        });
        try {
          const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
            responseType: 'stream',
          });
          const text = await collectStream(response.data);
          expect(text.toString('utf8')).toBe(payload);
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    // Sending a Node.js Readable stream as the request body requires the HTTP
    // adapter; the XHR adapter on GJS cannot consume a Node.js Readable.
    await on('Node.js', async () => {
      await it('POST with Readable stream as body — server receives full body', async () => {
        const content = 'stream body content via readable';
        const srv = await startHTTPServer(async (req, res) => {
          const body = await readBody(req);
          res.end(body);
        });
        try {
          const readable = Readable.from([content]);
          const response = await axios.post(`http://127.0.0.1:${srv.port}/`, readable, {
            responseType: 'text',
            headers: { 'Content-Type': 'text/plain' },
          });
          expect(response.data).toBe(content);
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await it('POST with Buffer body — server receives correct bytes', async () => {
      const buf = Buffer.alloc(1024, 'x');
      const srv = await startHTTPServer(async (req, res) => {
        const body = await readBody(req);
        res.end(body);
      });
      try {
        const response = await axios.post(`http://127.0.0.1:${srv.port}/`, buf, {
          responseType: 'arraybuffer',
        });
        const received = Buffer.from(response.data);
        expect(received.toString()).toBe(buf.toString());
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('large response body (128 KB) is fully streamed', async () => {
      const size = 128 * 1024;
      const srv = await startHTTPServer((req, res) => {
        res.end(Buffer.alloc(size, 'a'));
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          responseType: 'arraybuffer',
        });
        expect(Buffer.from(response.data).length).toBe(size);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('responseType: "arraybuffer" returns binary data (ArrayBuffer or Buffer)', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.end(Buffer.from([1, 2, 3, 4]));
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          responseType: 'arraybuffer',
        });
        // Node.js: axios returns Buffer; GJS: axios returns ArrayBuffer
        const isBinary = response.data instanceof ArrayBuffer || Buffer.isBuffer(response.data);
        expect(isBinary).toBe(true);
        expect(new Uint8Array(response.data instanceof ArrayBuffer ? response.data : (response.data as Buffer).buffer)[0]).toBe(1);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    // req.pipe(res) requires stream-based HTTP and responseType:'stream'; both
    // require the HTTP adapter — not available via the XHR adapter on GJS.
    await on('Node.js', async () => {
      await it('req.pipe(res) echo server — stream round-trip matches original', async () => {
        const payload = 'piped echo payload';
        const srv = await startHTTPServer((req, res) => {
          req.pipe(res);
        });
        try {
          const response = await axios.post(`http://127.0.0.1:${srv.port}/`, payload, {
            headers: { 'Content-Type': 'text/plain' },
            responseType: 'stream',
          });
          const text = await collectStream(response.data);
          expect(text.toString('utf8')).toBe(payload);
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });
  });
};
