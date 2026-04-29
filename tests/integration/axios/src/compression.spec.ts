// Ported from refs/axios/tests/unit/adapters/http.test.js (compression describe block)
// Original: MIT, axios contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

// Note: brotli test is Node.js-only — @gjsify/zlib has no brotli support (no native API in GJS Web platform)
import { describe, it, expect, on } from '@gjsify/unit';
import axios from 'axios';
import { startHTTPServer, stopHTTPServer, gzipAsync, deflateAsync, brotliAsync } from './test-server.js';
import { deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const deflateRawAsync = promisify(deflateRaw);

export default async () => {
  await describe('axios: compression', async () => {
    await it('gzip-encoded response is automatically decompressed', async () => {
      const data = { firstName: 'Fred', lastName: 'Flintstone' };
      const compressed = await gzipAsync(JSON.stringify(data));
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Encoding', 'gzip');
        res.end(compressed);
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`);
        expect(response.data).toStrictEqual(data);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('deflate-encoded response is automatically decompressed', async () => {
      const body = 'deflate test';
      const compressed = await deflateAsync(body);
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Encoding', 'deflate');
        res.end(compressed);
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          responseType: 'text',
        });
        expect(response.data).toBe(body);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    // HTTP adapter detects raw deflate vs. zlib-wrapped deflate by inspecting the
    // first byte; DecompressionStream('deflate') on GJS follows RFC 7230 and
    // requires the zlib wrapper (RFC 1950), so raw deflate fails.
    await on('Node.js', async () => {
      await it('deflate-raw (deflate-raw header) is decompressed', async () => {
        const body = 'deflate-raw test';
        const compressed = await deflateRawAsync(body);
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Content-Encoding', 'deflate');
          res.end(compressed);
        });
        try {
          const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
            responseType: 'text',
          });
          expect(response.data).toBe(body);
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await on('Node.js', async () => {
      await it('brotli (br) encoded response is automatically decompressed', async () => {
        const body = 'brotli test';
        const compressed = await brotliAsync(body);
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Content-Encoding', 'br');
          res.end(compressed);
        });
        try {
          const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
            responseType: 'text',
          });
          expect(response.data).toBe(body);
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    // decompress: false is an HTTP adapter feature — it strips Accept-Encoding and
    // skips zlib inflate. The XHR adapter on GJS uses Soup which always decompresses
    // when ContentDecoder is present (and our fetch code uses DecompressionStream).
    await on('Node.js', async () => {
      await it('decompress: false disables auto-decompression', async () => {
        const body = 'Test data';
        const compressed = await gzipAsync(body);
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Content-Type', 'text/html;charset=utf-8');
          res.setHeader('Content-Encoding', 'gzip');
          res.end(compressed);
        });
        try {
          const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
            decompress: false,
            responseType: 'arraybuffer',
          });
          // Raw bytes must match the compressed buffer
          expect(Buffer.from(response.data).toString('base64')).toBe(compressed.toString('base64'));
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await it('invalid gzip body rejects with a decompression error', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.statusCode = 206;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Encoding', 'gzip');
        res.end('invalid gzip data');
      });
      try {
        let error: any;
        try { await axios.get(`http://127.0.0.1:${srv.port}/`); } catch (e) { error = e; }
        expect(error).toBeDefined();
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('empty gzip response body is handled (no Z_BUF_ERROR)', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Encoding', 'gzip');
        res.end();
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`);
        expect(response.data).toBe('');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('chunked transfer + gzip decoded correctly', async () => {
      const body = 'chunked gzip test';
      const compressed = await gzipAsync(body);
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.removeHeader('Content-Length');
        res.write(compressed);
        res.end();
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          responseType: 'text',
        });
        expect(response.data).toBe(body);
      } finally {
        await stopHTTPServer(srv);
      }
    });
  });
};
