// GJS-only integration tests for http2 server + client (Soup.Server / Soup.Session backed)
// These tests only run on GJS since they require Soup 3.0.
// Wrapped in on('Gjs') — not executed on Node.js.

import { describe, it, expect, on } from '@gjsify/unit';
import http2 from 'node:http2';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AnyServer = ReturnType<typeof http2.createServer>;
type AnyStream = ReturnType<ReturnType<typeof http2.connect>['request']>;

function withServer(
  handler: (req: any, res: any) => void,
): Promise<{ server: AnyServer; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http2.createServer(handler);
    server.once('error', reject);
    server.listen(0, () => {
      const port = (server.address() as any)?.port;
      if (!port) return reject(new Error('Could not get server port'));
      resolve({ server, port });
    });
  });
}

function collectBody(stream: AnyStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    (stream as any).on('data', (chunk: Buffer) => chunks.push(chunk));
    (stream as any).on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    (stream as any).on('error', reject);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

export default async () => {
  await on('Gjs', async () => {

    await describe('http2.createServer()', async () => {
      await it('returns an server instance with listen/close', async () => {
        const server = http2.createServer();
        expect(server).toBeDefined();
        expect(typeof (server as any).listen).toBe('function');
        expect(typeof (server as any).close).toBe('function');
      });

      await it('listen() starts listening and emits listening', async () => {
        const server = http2.createServer();
        await new Promise<void>((resolve, reject) => {
          (server as any).once('error', reject);
          (server as any).listen(0, resolve);
        });
        expect((server as any).listening).toBeTruthy();
        const addr = (server as any).address();
        expect(addr).toBeDefined();
        expect(addr.port > 0).toBeTruthy();
        (server as any).close();
      });

      await it('close() stops listening', async () => {
        const server = http2.createServer();
        await new Promise<void>((res) => (server as any).listen(0, res));
        await new Promise<void>((res) => (server as any).close(res));
        expect((server as any).listening).toBeFalsy();
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

        const session = http2.connect(`http://localhost:${port}`);
        const stream = session.request({ ':method': 'GET', ':path': '/' }, { endStream: true } as any);

        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        session.close();
        (server as any).close();
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

        const session = http2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/hello?foo=bar' },
          { endStream: true } as any,
        );

        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(capturedMethod).toBe('GET');
        expect(capturedUrl).toBe('/hello?foo=bar');

        session.close();
        (server as any).close();
      });

      await it('req.headers contains custom request headers', async () => {
        let capturedHeaders: Record<string, string | string[]> = {};

        const { server, port } = await withServer((req, res) => {
          capturedHeaders = req.headers;
          res.writeHead(200);
          res.end();
        });

        const session = http2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/', 'x-custom': 'test-value' },
          { endStream: true } as any,
        );

        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(capturedHeaders['x-custom']).toBe('test-value');

        session.close();
        (server as any).close();
      });
    });

    await describe('http2 compat API: response body', async () => {
      await it('response body text is received by client stream', async () => {
        const { server, port } = await withServer((_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('Hello HTTP/2');
        });

        const session = http2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/' },
          { endStream: true } as any,
        );

        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        const body = await collectBody(stream);

        expect(body).toBe('Hello HTTP/2');

        session.close();
        (server as any).close();
      });

      await it(':status is included in response headers', async () => {
        const { server, port } = await withServer((_req, res) => {
          res.writeHead(201);
          res.end('created');
        });

        const session = http2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'POST', ':path': '/items' },
          { endStream: true } as any,
        );

        let responseHeaders: Record<string, string | string[]> = {};
        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', (headers: any) => {
            responseHeaders = headers;
            resolve();
          });
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });
        await collectBody(stream);

        expect(responseHeaders[':status']).toBe('201');

        session.close();
        (server as any).close();
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

        const session = http2.connect(`http://localhost:${port}`);
        const stream = session.request({
          ':method': 'POST',
          ':path': '/upload',
          'content-type': 'text/plain',
        });

        (stream as any).write('Hello');
        (stream as any).end(' World');

        await new Promise<void>((resolve, reject) => {
          (stream as any).on('response', () => resolve());
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(capturedBody).toBe('Hello World');

        session.close();
        (server as any).close();
      });
    });

    await describe('http2 session API: stream event', async () => {
      await it('server emits stream event with headers', async () => {
        let streamEventFired = false;

        const server = http2.createServer();
        (server as any).on('stream', (stream: any, headers: any) => {
          streamEventFired = true;
          expect(stream).toBeDefined();
          expect(typeof stream.respond).toBe('function');
          expect(typeof headers).toBe('object');
          stream.respond({ ':status': 200, 'content-type': 'text/plain' });
          stream.end('stream API response');
        });

        await new Promise<void>((res) => (server as any).listen(0, res));
        const port = (server as any).address()?.port ?? 0;

        const session = http2.connect(`http://localhost:${port}`);
        const stream = session.request(
          { ':method': 'GET', ':path': '/' },
          { endStream: true } as any,
        );

        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          (stream as any).on('response', () => {});
          (stream as any).on('data', (chunk: Buffer) => chunks.push(chunk));
          (stream as any).on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          (stream as any).on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 5000);
        });

        expect(body).toBe('stream API response');
        expect(streamEventFired).toBeTruthy();

        session.close();
        (server as any).close();
      });
    });

    await describe('http2.connect()', async () => {
      await it('returns a session with request() method', async () => {
        const session = http2.connect('http://localhost:19999');
        expect(session).toBeDefined();
        expect(typeof session.request).toBe('function');
        expect(typeof session.close).toBe('function');
        session.close();
      });

      await it('session.request() returns a stream with on()', async () => {
        const session = http2.connect('http://localhost:19999');
        const stream = session.request({ ':method': 'GET', ':path': '/' });
        expect(stream).toBeDefined();
        expect(typeof (stream as any).on).toBe('function');
        session.close();
      });
    });

  });
};
