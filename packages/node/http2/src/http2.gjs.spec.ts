// GJS-only integration tests for http2 server + client (Soup.Server / Soup.Session backed)
// These tests only run on GJS since they require Soup 3.0.
// Wrapped in on('Gjs') — not executed on Node.js.
//
// Phase-2 tests (pushStream, respondWithFD, respondWithFile) ported from:
//   refs/node-test/parallel/test-http2-server-push-stream.js   (MIT, Node.js contributors)
//   refs/node-test/parallel/test-http2-respond-file.js         (MIT, Node.js contributors)
//   refs/node-test/parallel/test-http2-respond-file-fd.js      (MIT, Node.js contributors)
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Type strategy (Workstream G): runtime values come from `node:http2` so the Node
// bundle stays free of `gi://*` imports (this file is loaded by the same `test.mts`
// aggregator that also drives `test:node`, even though the suite body is no-op on
// Node via `on('Gjs', …)`). For static typing we pull the impl-private classes from
// `@gjsify/http2` via type-only imports — stripped at compile time, so the Node
// bundle is unaffected, but TypeScript sees the real shapes (`Http2Server`,
// `Http2ServerRequest/Response`, `ClientHttp2Session/Stream`) and the entire
// `as any` chain that `@types/node`'s narrower declarations would force disappears.

import { describe, it, expect, on } from '@gjsify/unit';
import http2 from 'node:http2';
import { writeFileSync, openSync, closeSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Http2Server,
  Http2ServerRequest,
  Http2ServerResponse,
  ClientHttp2Session,
  ClientHttp2Stream,
  ServerHttp2Stream,
} from '@gjsify/http2';

// Local view of `node:http2`'s default export retyped against our impl-private
// classes. `node:http2` is the runtime source on both Node and GJS (alias-mapped
// to `@gjsify/http2` on the GJS target by the build), but its declarations come
// from `@types/node` and don't expose the GJS-only shapes we want to assert
// against. This cast is the single boundary between the two views.
const gjsHttp2 = http2 as unknown as {
  createServer(handler?: (req: Http2ServerRequest, res: Http2ServerResponse) => void): Http2Server;
  connect(authority: string): ClientHttp2Session;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withServer(
  handler: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
): Promise<{ server: Http2Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = gjsHttp2.createServer(handler);
    server.once('error', reject);
    server.listen(0, () => {
      const port = server.address()?.port;
      if (!port) return reject(new Error('Could not get server port'));
      resolve({ server, port });
    });
  });
}

function collectBody(stream: ClientHttp2Stream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

export default async () => {
  await on('Gjs', async () => {

    await describe('gjsHttp2.createServer()', async () => {
      await it('returns an server instance with listen/close', async () => {
        const server = gjsHttp2.createServer();
        expect(server).toBeDefined();
        expect(typeof server.listen).toBe('function');
        expect(typeof server.close).toBe('function');
      });

      await it('listen() starts listening and emits listening', async () => {
        const server = gjsHttp2.createServer();
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, resolve);
        });
        expect(server.listening).toBeTruthy();
        const addr = server.address();
        expect(addr).toBeDefined();
        expect((addr?.port ?? 0) > 0).toBeTruthy();
        server.close();
      });

      await it('close() stops listening', async () => {
        const server = gjsHttp2.createServer();
        await new Promise<void>((res) => server.listen(0, res));
        await new Promise<void>((res) => server.close(() => res()));
        expect(server.listening).toBeFalsy();
      });
    });

    await describe('http2 compat API: request event', async () => {
      await it('emits request with req and res objects', async () => {
        const { server, port } = await withServer((req, res) => {
          expect(req).toBeDefined();
          expect(res).toBeDefined();
          expect(typeof req.method).toBe('string');
          res.writeHead(200);
          res.end();
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request({ ':method': 'GET', ':path': '/' }, { endStream: true });

        await new Promise<void>((resolve, reject) => {
          stream.on('response', () => resolve());
          stream.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        session.close();
        server.close();
      });

      await it('req.method and req.url are populated', async () => {
        let capturedMethod = '';
        let capturedUrl = '';

        const { server, port } = await withServer((req, res) => {
          capturedMethod = req.method;
          capturedUrl = req.url;
          res.writeHead(204);
          res.end();
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/hello?foo=bar' },
          { endStream: true },
        );

        await new Promise<void>((resolve, reject) => {
          stream.on('response', () => resolve());
          stream.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(capturedMethod).toBe('GET');
        expect(capturedUrl).toBe('/hello?foo=bar');

        session.close();
        server.close();
      });

      await it('req.headers contains custom request headers', async () => {
        let capturedHeaders: Record<string, string | string[]> = {};

        const { server, port } = await withServer((req, res) => {
          capturedHeaders = req.headers;
          res.writeHead(200);
          res.end();
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/', 'x-custom': 'test-value' },
          { endStream: true },
        );

        await new Promise<void>((resolve, reject) => {
          stream.on('response', () => resolve());
          stream.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(capturedHeaders['x-custom']).toBe('test-value');

        session.close();
        server.close();
      });
    });

    await describe('http2 compat API: response body', async () => {
      await it('response body text is received by client stream', async () => {
        const { server, port } = await withServer((_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('Hello HTTP/2');
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/' },
          { endStream: true },
        );

        await new Promise<void>((resolve, reject) => {
          stream.on('response', () => resolve());
          stream.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        const body = await collectBody(stream);

        expect(body).toBe('Hello HTTP/2');

        session.close();
        server.close();
      });

      await it(':status is included in response headers', async () => {
        const { server, port } = await withServer((_req, res) => {
          res.writeHead(201);
          res.end('created');
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'POST', ':path': '/items' },
          { endStream: true },
        );

        let responseHeaders: Record<string, string | string[]> = {};
        await new Promise<void>((resolve, reject) => {
          stream.on('response', (headers: Record<string, string | string[]>) => {
            responseHeaders = headers;
            resolve();
          });
          stream.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        await collectBody(stream);

        expect(responseHeaders[':status']).toBe('201');

        session.close();
        server.close();
      });
    });

    await describe('http2 compat API: request body', async () => {
      await it('server receives POST body via async iteration on req', async () => {
        let capturedBody = '';

        const { server, port } = await withServer(async (req, res) => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          capturedBody = Buffer.concat(chunks).toString('utf8');
          res.writeHead(200);
          res.end('ok');
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request({
          ':method': 'POST',
          ':path': '/upload',
          'content-type': 'text/plain',
        });

        stream.write('Hello');
        stream.end(' World');

        await new Promise<void>((resolve, reject) => {
          stream.on('response', () => resolve());
          stream.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(capturedBody).toBe('Hello World');

        session.close();
        server.close();
      });
    });

    await describe('http2 session API: stream event', async () => {
      await it('server emits stream event with headers', async () => {
        let streamEventFired = false;

        const server = gjsHttp2.createServer();
        server.on('stream', (stream: ServerHttp2Stream, headers: Record<string, string | string[]>) => {
          streamEventFired = true;
          expect(stream).toBeDefined();
          expect(typeof stream.respond).toBe('function');
          expect(typeof headers).toBe('object');
          stream.respond({ ':status': 200, 'content-type': 'text/plain' });
          stream.end('stream API response');
        });

        await new Promise<void>((res) => server.listen(0, res));
        const port = server.address()?.port ?? 0;

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/' },
          { endStream: true },
        );

        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('response', () => {});
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          stream.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(body).toBe('stream API response');
        expect(streamEventFired).toBeTruthy();

        session.close();
        server.close();
      });
    });

    await describe('gjsHttp2.connect()', async () => {
      await it('returns a session with request() method', async () => {
        const session: ClientHttp2Session = gjsHttp2.connect('http://localhost:19999');
        expect(session).toBeDefined();
        expect(typeof session.request).toBe('function');
        expect(typeof session.close).toBe('function');
        session.close();
      });

      await it('session.request() returns a stream with on()', async () => {
        const session = gjsHttp2.connect('http://localhost:19999');
        const stream = session.request({ ':method': 'GET', ':path': '/' });
        expect(stream).toBeDefined();
        expect(typeof stream.on).toBe('function');
        session.close();
      });
    });

    // ─── Phase 2: respondWithFile / respondWithFD ────────────────────────────
    // Ported from refs/node-test/parallel/test-http2-respond-file.js
    //              refs/node-test/parallel/test-http2-respond-file-fd.js
    // Original: Copyright (c) Node.js contributors. MIT.

    await describe('http2 respondWithFile()', async () => {
      let tmpDir = '';
      let fname = '';
      const data = 'Hello from a file served by http2.respondWithFile!\n';

      tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-http2-'));
      fname = join(tmpDir, 'sample.txt');
      writeFileSync(fname, data);

      await it('streams a file by path through the response body', async () => {
        const { server, port } = await withServer((_req, res) => {
          (res as any).respondWithFile(fname, { 'content-type': 'text/plain' });
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/' },
          { endStream: true } as any,
        );

        let captured: Record<string, string | string[]> = {};
        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', (h: any) => { captured = h; resolve(); });
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        const body = await collectBody(stream);

        expect(body).toBe(data);
        expect(captured['content-type']).toBe('text/plain');

        session.close();
        (server as any).close();
      });

      await it('statCheck() can mutate response headers based on file stat', async () => {
        let statSeen: any = null;
        const { server, port } = await withServer((_req, res) => {
          (res as any).respondWithFile(
            fname,
            { 'content-type': 'text/plain' },
            {
              statCheck: (stat: any, headers: any) => {
                statSeen = stat;
                headers['content-length'] = String(stat.size);
                headers['x-stat-mtime'] = String(stat.mtimeMs ?? stat.mtime?.getTime?.() ?? 0);
              },
            },
          );
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/' },
          { endStream: true } as any,
        );

        let captured: Record<string, string | string[]> = {};
        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', (h: any) => { captured = h; resolve(); });
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        await collectBody(stream);

        expect(statSeen).toBeTruthy();
        expect(Number(captured['content-length'])).toBe(data.length);
        expect(typeof captured['x-stat-mtime']).toBe('string');

        session.close();
        (server as any).close();
      });

      // Cleanup. Best-effort — tmpdir lives under /tmp so test failures don't pollute.
      await it('cleanup', async () => {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      });
    });

    await describe('http2 respondWithFD()', async () => {
      let tmpDir = '';
      let fname = '';
      const data = 'FD-streamed body\n';

      tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-http2-fd-'));
      fname = join(tmpDir, 'fd.txt');
      writeFileSync(fname, data);

      await it('streams an open file descriptor through the response body', async () => {
        const fd = openSync(fname, 'r');
        const { server, port } = await withServer((_req, res) => {
          (res as any).respondWithFD(fd, {
            'content-type': 'text/plain',
            'content-length': String(data.length),
          });
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/' },
          { endStream: true } as any,
        );

        let captured: Record<string, string | string[]> = {};
        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', (h: any) => { captured = h; resolve(); });
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        const body = await collectBody(stream);

        expect(body).toBe(data);
        expect(Number(captured['content-length'])).toBe(data.length);

        session.close();
        (server as any).close();
        try { closeSync(fd); } catch {}
      });

      await it('cleanup', async () => {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      });
    });

    // ─── Phase 2: pushStream ─────────────────────────────────────────────────
    // Ported from refs/node-test/parallel/test-http2-server-push-stream.js
    // Original: Copyright (c) Node.js contributors. MIT.
    //
    // Soup does not expose the underlying nghttp2 session, so the
    // PUSH_PROMISE frame the bridge constructs cannot be delivered to the
    // client over the active Soup connection. These tests verify the
    // server-side API contract instead: callback fired, ServerHttp2Stream
    // synthesised, even stream-id allocated, headers + frame bytes
    // observable. See STATUS.md "Open TODOs" → "http2 PUSH_PROMISE wire
    // delivery" for the wire-level follow-up.

    await describe('http2 pushStream() — API contract', async () => {
      await it('callback fires with a ServerHttp2Stream + push headers', async () => {
        let pushedStream: any = null;
        let pushedHeaders: any = null;

        const { server, port } = await withServer((_req, res) => {
          (res as any).pushStream(
            {
              ':path': '/foobar',
              ':authority': `localhost:${port}`,
              ':scheme': 'http',
            },
            (err: Error | null, stream: any, hdrs: any) => {
              if (err) { res.writeHead(500); res.end(); return; }
              pushedStream = stream;
              pushedHeaders = hdrs;
              stream.respond({ ':status': 200, 'content-type': 'text/plain' });
              stream.end('pushed body');
              res.writeHead(200);
              res.end('main body');
            },
          );
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request({ ':method': 'GET', ':path': '/' }, { endStream: true } as any);

        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        await collectBody(stream);

        expect(pushedStream).toBeTruthy();
        expect(typeof pushedStream.respond).toBe('function');
        expect(pushedHeaders).toBeTruthy();
        expect(pushedHeaders[':path']).toBe('/foobar');
        // Even server-allocated stream id (RFC 7540 §5.1.1).
        expect(pushedStream.id % 2 === 0).toBeTruthy();
        expect(pushedStream.id >= 2).toBeTruthy();

        session.close();
        (server as any).close();
      });

      await it('pushStream on a pushed stream rejects with ERR_HTTP2_NESTED_PUSH', async () => {
        let nestedError: any = null;

        const { server, port } = await withServer((_req, res) => {
          (res as any).pushStream(
            { ':path': '/lvl1', ':authority': `localhost:${port}`, ':scheme': 'http' },
            (err: Error | null, stream: any) => {
              if (err) { res.writeHead(500); res.end(); return; }
              // Nested push must fail per RFC 7540 §8.2.
              stream.pushStream(
                { ':path': '/lvl2', ':authority': `localhost:${port}`, ':scheme': 'http' },
                (innerErr: any) => { nestedError = innerErr; },
              );
              stream.respond({ ':status': 200 });
              stream.end('lvl1 body');
              res.writeHead(200);
              res.end('main');
            },
          );
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request({ ':method': 'GET', ':path': '/' }, { endStream: true } as any);
        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        await collectBody(stream);

        // Allow the async push callback chain to settle.
        await new Promise((r) => setTimeout(r, 20));

        expect(nestedError).toBeTruthy();
        expect((nestedError as any).code).toBe('ERR_HTTP2_NESTED_PUSH');

        session.close();
        (server as any).close();
      });

      await it('allocates monotonically-increasing even ids across multiple pushes', async () => {
        const ids: number[] = [];
        const { server, port } = await withServer(async (_req, res) => {
          await new Promise<void>((res2) => {
            (res as any).pushStream(
              { ':path': '/a', ':authority': `localhost:${port}`, ':scheme': 'http' },
              (err: any, s1: any) => {
                if (s1) ids.push(s1.id);
                if (s1) { s1.respond({ ':status': 200 }); s1.end('a'); }
                (res as any).pushStream(
                  { ':path': '/b', ':authority': `localhost:${port}`, ':scheme': 'http' },
                  (err2: any, s2: any) => {
                    if (s2) ids.push(s2.id);
                    if (s2) { s2.respond({ ':status': 200 }); s2.end('b'); }
                    res2();
                  },
                );
              },
            );
          });
          res.writeHead(200);
          res.end('main');
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request({ ':method': 'GET', ':path': '/' }, { endStream: true } as any);
        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        await collectBody(stream);

        expect(ids.length).toBe(2);
        expect(ids[0] % 2 === 0).toBeTruthy();
        expect(ids[1] % 2 === 0).toBeTruthy();
        expect(ids[1] > ids[0]).toBeTruthy();

        session.close();
        (server as any).close();
      });

      await it('createPushResponse() yields a usable Http2ServerResponse', async () => {
        let pushRes: any = null;
        const { server, port } = await withServer((_req, res) => {
          (res as any).createPushResponse(
            { ':path': '/aux', ':authority': `localhost:${port}`, ':scheme': 'http' },
            (err: any, child: any) => {
              if (child) {
                pushRes = child;
                child.writeHead(200, { 'content-type': 'text/plain' });
                child.end('pushed');
              }
              res.writeHead(200);
              res.end('parent');
            },
          );
        });

        const session = gjsHttp2.connect(`http://localhost:${port}`);
        const stream = session.request({ ':method': 'GET', ':path': '/' }, { endStream: true } as any);
        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        await collectBody(stream);

        await new Promise((r) => setTimeout(r, 20));

        expect(pushRes).toBeTruthy();
        expect(pushRes.statusCode).toBe(200);
        // The detached body is observable on push responses.
        const buf = pushRes.detachedBody;
        expect(buf).toBeTruthy();
        if (buf) expect(buf.toString('utf8')).toBe('pushed');

        session.close();
        (server as any).close();
      });
    });

  });
};
