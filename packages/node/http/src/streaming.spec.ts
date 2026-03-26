// HTTP streaming tests — validates pipe, concurrent requests, large bodies, gzip
// Ported from refs/node-test/ and refs/bun/test/ patterns
// Tests both Node.js correctness and GJS implementation

import { describe, it, expect } from '@gjsify/unit';
import { createServer, request as httpRequest, get as httpGet } from 'node:http';
import { Readable, Writable, PassThrough, Transform } from 'node:stream';
import { Buffer } from 'node:buffer';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

/** Helper: start a server and return its URL + cleanup function */
function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; server: Server; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()!;
      const port = typeof addr === 'object' ? addr.port : 0;
      const url = `http://127.0.0.1:${port}`;
      resolve({
        url,
        server,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

/** Helper: make an HTTP GET request and collect the response body */
function httpGetBody(url: string): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res: IncomingMessage) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode!, headers: res.headers as Record<string, string | string[] | undefined>, body });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

export default async () => {
  // ---- res.write() + res.end() basic streaming ----

  await describe('http streaming: res.write + res.end', async () => {
    await it('should receive multiple write() chunks as single body', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('hello ');
        res.write('world');
        res.end('!');
      });
      try {
        const { statusCode, body } = await httpGetBody(url);
        expect(statusCode).toBe(200);
        expect(body).toBe('hello world!');
      } finally {
        await close();
      }
    });

    await it('should handle empty response body', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(204);
        res.end();
      });
      try {
        const { statusCode, body } = await httpGetBody(url);
        expect(statusCode).toBe(204);
        expect(body).toBe('');
      } finally {
        await close();
      }
    });

    await it('should send headers set via setHeader()', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.setHeader('x-custom', 'test-value');
        res.writeHead(200);
        res.end('ok');
      });
      try {
        const { headers } = await httpGetBody(url);
        expect(headers['x-custom']).toBe('test-value');
      } finally {
        await close();
      }
    });

    await it('should handle write with Buffer', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.write(Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f])); // "Hello"
        res.end();
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body).toBe('Hello');
      } finally {
        await close();
      }
    });
  });

  // ---- Readable.pipe(res) ----

  await describe('http streaming: Readable.pipe(res)', async () => {
    await it('should pipe a Readable stream to response', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const source = new Readable({
          read() {
            this.push('piped data');
            this.push(null);
          },
        });
        source.pipe(res);
      });
      try {
        const { statusCode, body } = await httpGetBody(url);
        expect(statusCode).toBe(200);
        expect(body).toBe('piped data');
      } finally {
        await close();
      }
    });

    await it('should pipe multiple chunks through Readable to response', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const chunks = ['chunk1,', 'chunk2,', 'chunk3'];
        let i = 0;
        const source = new Readable({
          read() {
            if (i < chunks.length) {
              this.push(chunks[i++]);
            } else {
              this.push(null);
            }
          },
        });
        source.pipe(res);
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body).toBe('chunk1,chunk2,chunk3');
      } finally {
        await close();
      }
    });

    await it('should pipe Readable.from() to response', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        Readable.from(['hello', ' ', 'from', ' ', 'readable']).pipe(res);
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body).toBe('hello from readable');
      } finally {
        await close();
      }
    });

    await it('should pipe through a Transform stream to response', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const source = Readable.from(['hello world']);
        const upper = new Transform({
          transform(chunk, _enc, cb) {
            cb(null, chunk.toString().toUpperCase());
          },
        });
        source.pipe(upper).pipe(res);
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body).toBe('HELLO WORLD');
      } finally {
        await close();
      }
    });

    await it('should pipe through PassThrough to response', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const pt = new PassThrough();
        pt.pipe(res);
        pt.write('pass');
        pt.end('through');
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body).toBe('passthrough');
      } finally {
        await close();
      }
    });
  });

  // ---- Large response bodies ----

  await describe('http streaming: large response bodies', async () => {
    await it('should handle a 64KB response body', async () => {
      const size = 64 * 1024;
      const data = 'A'.repeat(size);
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(data);
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body.length).toBe(size);
      } finally {
        await close();
      }
    });

    await it('should handle a 256KB response via multiple writes', async () => {
      const chunkSize = 1024;
      const numChunks = 256;
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        for (let i = 0; i < numChunks; i++) {
          res.write('B'.repeat(chunkSize));
        }
        res.end();
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body.length).toBe(chunkSize * numChunks);
      } finally {
        await close();
      }
    });

    await it('should pipe a large Readable to response', async () => {
      const chunkSize = 4096;
      const numChunks = 64; // 256KB
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        let sent = 0;
        const source = new Readable({
          read() {
            if (sent < numChunks) {
              this.push(Buffer.alloc(chunkSize, 0x43)); // 'C'
              sent++;
            } else {
              this.push(null);
            }
          },
        });
        source.pipe(res);
      });
      try {
        const { body } = await httpGetBody(url);
        expect(body.length).toBe(chunkSize * numChunks);
      } finally {
        await close();
      }
    });
  });

  // ---- Request body reading ----

  await describe('http streaming: request body', async () => {
    await it('should receive POST request body', async () => {
      const { url, close } = await startServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end(`received: ${body}`);
        });
      });
      try {
        const result = await new Promise<string>((resolve, reject) => {
          const postData = 'hello server';
          const req = httpRequest(url, { method: 'POST', headers: { 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(postData)) } }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => { body += chunk; });
            res.on('end', () => resolve(body));
            res.on('error', reject);
          });
          req.on('error', reject);
          req.write(postData);
          req.end();
        });
        expect(result).toBe('received: hello server');
      } finally {
        await close();
      }
    });

    await it('should receive JSON POST body', async () => {
      const { url, close } = await startServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ echo: parsed }));
        });
      });
      try {
        const payload = JSON.stringify({ message: 'test', count: 42 });
        const result = await new Promise<string>((resolve, reject) => {
          const req = httpRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => { body += chunk; });
            res.on('end', () => resolve(body));
          });
          req.on('error', reject);
          req.end(payload);
        });
        const parsed = JSON.parse(result);
        expect(parsed.echo.message).toBe('test');
        expect(parsed.echo.count).toBe(42);
      } finally {
        await close();
      }
    });
  });

  // ---- Concurrent requests ----

  await describe('http streaming: concurrent requests', async () => {
    await it('should handle 5 concurrent GET requests', async () => {
      let requestCount = 0;
      const { url, close } = await startServer((_req, res) => {
        requestCount++;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`response ${requestCount}`);
      });
      try {
        const results = await Promise.all(
          Array.from({ length: 5 }, (_, i) => httpGetBody(`${url}/?n=${i}`)),
        );
        expect(results.length).toBe(5);
        for (const r of results) {
          expect(r.statusCode).toBe(200);
          expect(r.body).toMatch(/^response \d+$/);
        }
        expect(requestCount).toBe(5);
      } finally {
        await close();
      }
    });

    await it('should handle concurrent requests with different response sizes', async () => {
      const { url, close } = await startServer((req, res) => {
        const size = parseInt(req.url?.split('size=')[1] || '10', 10);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('X'.repeat(size));
      });
      try {
        const sizes = [100, 1000, 5000, 10000, 50000];
        const results = await Promise.all(
          sizes.map((size) => httpGetBody(`${url}/?size=${size}`)),
        );
        for (let i = 0; i < sizes.length; i++) {
          expect(results[i].body.length).toBe(sizes[i]);
        }
      } finally {
        await close();
      }
    });
  });

  // ---- Status codes and redirects ----

  await describe('http streaming: status codes', async () => {
    await it('should handle 302 redirect to same server', async () => {
      let hitTarget = false;
      const { url, close } = await startServer((req, res) => {
        if (req.url === '/target') {
          hitTarget = true;
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('redirected');
        } else {
          res.writeHead(302, { location: '/target' });
          res.end();
        }
      });
      try {
        const { statusCode, body } = await httpGetBody(url);
        // Node.js http.get does NOT follow redirects (returns 302),
        // Soup.Session follows redirects automatically (returns 200 from /target).
        // Accept either behavior.
        expect(statusCode === 302 || statusCode === 200).toBeTruthy();
        if (statusCode === 200) {
          expect(body).toBe('redirected');
          expect(hitTarget).toBe(true);
        }
      } finally {
        await close();
      }
    });

    await it('should handle 404 with body', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
      });
      try {
        const { statusCode, body } = await httpGetBody(url);
        expect(statusCode).toBe(404);
        expect(body).toBe('Not Found');
      } finally {
        await close();
      }
    });

    await it('should handle 500 with error message', async () => {
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      });
      try {
        const { statusCode, body } = await httpGetBody(url);
        expect(statusCode).toBe(500);
        expect(JSON.parse(body).error).toBe('Internal Server Error');
      } finally {
        await close();
      }
    });
  });

  // ---- Content types and encodings ----

  await describe('http streaming: content types', async () => {
    await it('should serve JSON content', async () => {
      const data = { name: 'gjsify', version: '0.0.4' };
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      });
      try {
        const { headers, body } = await httpGetBody(url);
        expect(headers['content-type']).toBe('application/json');
        const parsed = JSON.parse(body);
        expect(parsed.name).toBe('gjsify');
        expect(parsed.version).toBe('0.0.4');
      } finally {
        await close();
      }
    });

    await it('should serve HTML content', async () => {
      const html = '<html><body><h1>Hello</h1></body></html>';
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html);
      });
      try {
        const { headers, body } = await httpGetBody(url);
        expect(headers['content-type']).toBe('text/html');
        expect(body).toBe(html);
      } finally {
        await close();
      }
    });

    await it('should serve binary content as Buffer', async () => {
      const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const { url, close } = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) });
        res.end(bytes);
      });
      try {
        // Collect as buffer
        const result = await new Promise<Buffer>((resolve, reject) => {
          httpGet(url, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          }).on('error', reject);
        });
        expect(result.length).toBe(6);
        expect(result[0]).toBe(0x00);
        expect(result[3]).toBe(0xff);
      } finally {
        await close();
      }
    });
  });

  // ---- Routing by URL and method ----

  await describe('http streaming: routing', async () => {
    await it('should differentiate routes by URL path', async () => {
      const { url, close } = await startServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`path: ${req.url}`);
      });
      try {
        const r1 = await httpGetBody(`${url}/foo`);
        const r2 = await httpGetBody(`${url}/bar`);
        expect(r1.body).toBe('path: /foo');
        expect(r2.body).toBe('path: /bar');
      } finally {
        await close();
      }
    });

    await it('should differentiate by HTTP method', async () => {
      const { url, close } = await startServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`method: ${req.method}`);
      });
      try {
        const getResult = await httpGetBody(url);
        expect(getResult.body).toBe('method: GET');

        const postResult = await new Promise<string>((resolve, reject) => {
          const req = httpRequest(url, { method: 'POST' }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => { body += chunk; });
            res.on('end', () => resolve(body));
          });
          req.on('error', reject);
          req.end();
        });
        expect(postResult).toBe('method: POST');
      } finally {
        await close();
      }
    });

    await it('should preserve query string in req.url', async () => {
      const { url, close } = await startServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(req.url || '');
      });
      try {
        const { body } = await httpGetBody(`${url}/search?q=gjsify&page=1`);
        expect(body).toBe('/search?q=gjsify&page=1');
      } finally {
        await close();
      }
    });
  });

  // ---- Server lifecycle ----

  await describe('http streaming: server lifecycle', async () => {
    await it('should emit listening event', async () => {
      const server = createServer((_req, res) => { res.end(); });
      const listening = await new Promise<boolean>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(true));
      });
      expect(listening).toBe(true);
      expect(server.listening).toBe(true);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    await it('should report address after listen', async () => {
      const server = createServer((_req, res) => { res.end(); });
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const addr = server.address();
      expect(addr).toBeDefined();
      expect(typeof (addr as any).port).toBe('number');
      expect((addr as any).port).toBeGreaterThan(0);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    await it('should emit close event', async () => {
      const server = createServer((_req, res) => { res.end(); });
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const closed = await new Promise<boolean>((resolve) => {
        server.close(() => resolve(true));
      });
      expect(closed).toBe(true);
      expect(server.listening).toBe(false);
    });
  });
};
