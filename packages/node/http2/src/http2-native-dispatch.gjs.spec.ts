// Phase-1 spec for the native HTTP/2 dispatcher.
//
// Drives `createServer({ allowHTTP1: false })` end-to-end via an in-process
// `SessionBridge.new_client()` riding on a raw `Gio.SocketClient` TCP socket.
// This avoids the curl-subprocess + node:http2-client wiring; both endpoints
// share the same nghttp2-backed bridge, so we exercise the full preface +
// SETTINGS + HEADERS + DATA + END_STREAM round-trip across two real sockets
// without any external dependency.
//
// GJS-only — dispatcher lives in a Vala typelib.

import { describe, it, expect, on } from '@gjsify/unit';
import http2 from 'node:http2';
import type {
  Http2Server,
  Http2ServerRequest,
  Http2ServerResponse,
} from '@gjsify/http2';

import type { ClientHttp2Session } from '@gjsify/http2';

const gjsHttp2 = http2 as unknown as {
  createServer(
    opts: { allowHTTP1?: boolean; nativeDispatcher?: 'auto' | 'force' | 'off' },
    handler?: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
  ): Http2Server;
  connect(authority: string, options?: { nativeDispatcher?: 'auto' | 'force' | 'off' }): ClientHttp2Session;
};

async function startServer(
  handler: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
  options: { allowHTTP1?: boolean; nativeDispatcher?: 'auto' | 'force' | 'off' } = { allowHTTP1: false },
): Promise<{ server: Http2Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = gjsHttp2.createServer(options, handler);
    server.on('error', reject);
    server.on('listening', () => {
      const addr = server.address();
      if (!addr) {
        reject(new Error('Server has no address after listen'));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.listen(0);
  });
}

function closeServer(server: Http2Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export default async function () {
  await on('Gjs', async () => {
    await describe('Http2NativeDispatcher — startup and shutdown', async () => {
      await it('starts and stops a native dispatcher on createServer({allowHTTP1:false})', async () => {
        const { server, port } = await startServer((_req, res) => { res.end('ok'); });
        expect(port).toBeGreaterThan(0);
        expect(server.soupServer).toBeNull();
        expect(server.nativeDispatcher).not.toBe(null);
        await closeServer(server);
      });

      await it('rejects createServer({allowHTTP1:false, nativeDispatcher:"off"})', async () => {
        let threw: Error | null = null;
        try {
          await startServer(() => {}, { allowHTTP1: false, nativeDispatcher: 'off' });
        } catch (err) {
          threw = err instanceof Error ? err : new Error(String(err));
        }
        expect(threw).not.toBe(null);
        expect(threw!.message).toMatch(/native dispatcher/i);
      });

      await it('Soup path is used for createServer() default (HTTP/1.1)', async () => {
        const { server } = await startServer((_req, res) => { res.end('ok'); }, {});
        expect(server.soupServer).not.toBe(null);
        expect(server.nativeDispatcher).toBe(null);
        await closeServer(server);
      });
    });

    await describe('Http2NativeDispatcher — h2c round-trip via in-process SessionBridge client', async () => {
      // The http2 package's tsconfig deliberately keeps `@girs/*` types out of
      // scope so the Node bundle stays clean; the spec is GJS-only (gated by
      // `on('Gjs')`), so we load the native modules at runtime and cast.
      const Gio = (await import('gi://Gio?version=2.0' as string)).default as any;
      const GLib = (await import('gi://GLib?version=2.0' as string)).default as any;
      const GjsifyHttp2 = (await import('gi://GjsifyHttp2?version=1.0' as string)).default as any;

      type ClientFixture = {
        client: any;
        connection: any;
        inSource: any;
      };

      function openClient(port: number): ClientFixture {
        const client = GjsifyHttp2.SessionBridge.new_client();
        if (!client) throw new Error('SessionBridge.new_client() returned null');
        const sc = new Gio.SocketClient();
        const conn = sc.connect_to_host('127.0.0.1:' + port, 0, null);
        const socket = conn.get_socket();
        socket.set_blocking(false);
        const outStream = conn.get_output_stream();
        const inStream = conn.get_input_stream();

        const pump = (): void => {
          let out = client.drain_output();
          while (out.get_size() > 0) {
            outStream.write(out.get_data() as Uint8Array, null);
            out = client.drain_output();
          }
        };

        // Initial preface + SETTINGS.
        pump();

        // PollableInputStream.create_source — Gio.Socket.create_source is
        // marked introspectable=0 in the GIR (GSocketSourceFunc can't cross
        // the introspection boundary).
        const inSource = inStream.create_source(null);
        type Cb = () => boolean;
        const cb: Cb = () => {
          try {
            const bytes = inStream.read_bytes(16384, null);
            const n = bytes.get_size();
            if (n === 0) return false;
            client.feed_input(bytes);
            client.dispatch_pending();
            pump();
          } catch (err: any) {
            if (err && err.matches && err.matches(Gio.io_error_quark(), Gio.IOErrorEnum.WOULD_BLOCK)) {
              return true;
            }
            return false;
          }
          return true;
        };
        inSource.set_callback(cb as unknown as () => boolean);
        inSource.attach(GLib.MainContext.default());

        return {
          client,
          connection: conn,
          inSource,
        };
      }

      function closeClient(fx: ClientFixture): void {
        try { fx.inSource.destroy(); } catch {}
        try { fx.connection.close(null); } catch {}
        try { fx.client.close(); } catch {}
      }

      // Spin the GLib main loop on idle ticks until `pred()` returns true.
      async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (!pred()) {
          if (Date.now() > deadline) throw new Error('waitFor timed out');
          await new Promise<void>((res) => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { res(); return false; }));
        }
      }

      function pumpClient(fx: ClientFixture): void {
        const outStream = fx.connection.get_output_stream();
        let out = fx.client.drain_output();
        while (out.get_size() > 0) {
          outStream.write(out.get_data() as Uint8Array, null);
          out = fx.client.drain_output();
        }
      }

      await it('completes a GET request → response with body', async () => {
        const { server, port } = await startServer((req, res) => {
          if (req.url === '/hello') {
            res.setHeader('content-type', 'text/plain');
            res.end('hello from h2c');
            return;
          }
          res.statusCode = 404;
          res.end();
        });

        const fx = openClient(port);
        try {
          let responseHeaders: Array<[string, string]> | null = null;
          const chunks: string[] = [];
          let done = false;

          fx.client.connect('headers_received', (_b: unknown, _sid: number, headersVar: any) => {
            responseHeaders = headersVar.deep_unpack();
          });
          fx.client.connect('data_received', (_b: unknown, _sid: number, chunk: any, endStream: boolean) => {
            if (chunk.get_size() > 0) chunks.push(new TextDecoder().decode(chunk.get_data()));
            if (endStream) done = true;
          });

          fx.client.submit_request(
            [':method', ':scheme', ':authority', ':path'],
            ['GET', 'http', 'localhost', '/hello'],
            true,
          );
          pumpClient(fx);

          await waitFor(() => done);
          expect(responseHeaders).not.toBe(null);
          const headersMap: Record<string, string> = {};
          for (const [k, v] of responseHeaders!) headersMap[k] = v;
          expect(headersMap[':status']).toBe('200');
          expect(chunks.join('')).toBe('hello from h2c');
        } finally {
          closeClient(fx);
          await closeServer(server);
        }
      });

      await it('completes a POST request with body → echo response', async () => {
        const { server, port } = await startServer((req, res) => {
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (c: string) => { body += c; });
          req.on('end', () => {
            res.setHeader('content-type', 'text/plain');
            res.end('echo: ' + body);
          });
        });

        const fx = openClient(port);
        try {
          let responseHeaders: Array<[string, string]> | null = null;
          const chunks: string[] = [];
          let done = false;
          fx.client.connect('headers_received', (_b: unknown, _sid: number, headersVar: any) => {
            responseHeaders = headersVar.deep_unpack();
          });
          fx.client.connect('data_received', (_b: unknown, _sid: number, chunk: any, endStream: boolean) => {
            if (chunk.get_size() > 0) chunks.push(new TextDecoder().decode(chunk.get_data()));
            if (endStream) done = true;
          });

          const sid = fx.client.submit_request(
            [':method', ':scheme', ':authority', ':path', 'content-type'],
            ['POST', 'http', 'localhost', '/echo', 'text/plain'],
            false,
          );
          // Send the body as a single DATA frame with END_STREAM.
          fx.client.submit_data(sid, GLib.Bytes.new(new TextEncoder().encode('ping-payload')), true);
          pumpClient(fx);

          await waitFor(() => done);
          expect(responseHeaders).not.toBe(null);
          expect(chunks.join('')).toBe('echo: ping-payload');
        } finally {
          closeClient(fx);
          await closeServer(server);
        }
      });

      await it('delivers PUSH_PROMISE on the wire — client sees the promised stream', async () => {
        // Phase 2: pushStream() routes the PUSH_PROMISE frame through the
        // native dispatcher's SessionBridge.submit_push_promise(). The
        // client-side SessionBridge surfaces the frame as a
        // `push-promise-received` signal, then the promised stream's
        // HEADERS + DATA arrive on the same connection.
        const { server, port } = await startServer((_req, res) => {
          (res as any).stream.pushStream(
            { ':method': 'GET', ':scheme': 'http', ':authority': 'localhost', ':path': '/style.css' },
            (err: Error | null, pushStream: any) => {
              if (err) { res.statusCode = 500; res.end(); return; }
              pushStream.respond({ ':status': 200, 'content-type': 'text/css' });
              pushStream.end('body { color: red; }');
              res.setHeader('content-type', 'text/html');
              res.end('<html><link rel=stylesheet href=/style.css></html>');
            },
          );
        });

        const fx = openClient(port);
        try {
          let pushPromise: { sid: number; promisedSid: number; headers: Array<[string, string]> } | null = null;
          const responses = new Map<number, { headers: Array<[string, string]> | null; body: string; done: boolean }>();
          fx.client.connect('push_promise_received', (_b: unknown, sid: number, promisedSid: number, headersVar: any) => {
            pushPromise = { sid, promisedSid, headers: headersVar.deep_unpack() };
          });
          fx.client.connect('headers_received', (_b: unknown, sid: number, headersVar: any, _endStream: boolean) => {
            const cur = responses.get(sid) ?? { headers: null, body: '', done: false };
            cur.headers = headersVar.deep_unpack();
            responses.set(sid, cur);
          });
          fx.client.connect('data_received', (_b: unknown, sid: number, chunk: any, endStream: boolean) => {
            const cur = responses.get(sid) ?? { headers: null, body: '', done: false };
            if (chunk.get_size() > 0) cur.body += new TextDecoder().decode(chunk.get_data());
            if (endStream) cur.done = true;
            responses.set(sid, cur);
          });

          fx.client.submit_request(
            [':method', ':scheme', ':authority', ':path'],
            ['GET', 'http', 'localhost', '/'],
            true,
          );
          pumpClient(fx);

          await waitFor(() => pushPromise !== null && responses.get(1)?.done === true && responses.get(pushPromise!.promisedSid)?.done === true, 5000);

          // PUSH_PROMISE arrived on the wire ⇒ pushPromise !== null
          expect(pushPromise).not.toBe(null);
          expect(pushPromise!.sid).toBe(1); // promised on the request stream
          expect(pushPromise!.promisedSid % 2).toBe(0); // server-allocated even id
          const promisedHdrs: Record<string, string> = {};
          for (const [k, v] of pushPromise!.headers) promisedHdrs[k] = v;
          expect(promisedHdrs[':path']).toBe('/style.css');

          // Main stream response
          const main = responses.get(1)!;
          expect(main.body).toBe('<html><link rel=stylesheet href=/style.css></html>');

          // Pushed stream response
          const pushed = responses.get(pushPromise!.promisedSid)!;
          expect(pushed.body).toBe('body { color: red; }');
          const pushedHdrs: Record<string, string> = {};
          for (const [k, v] of pushed.headers!) pushedHdrs[k] = v;
          expect(pushedHdrs[':status']).toBe('200');
          expect(pushedHdrs['content-type']).toBe('text/css');
        } finally {
          closeClient(fx);
          await closeServer(server);
        }
      });

      await it('Phase 3 — http2.connect(h2c) drives a request via the native client', async () => {
        // Uses gjsHttp2.connect() — same API as Soup, but the http://
        // authority routes through Http2NativeClientDispatcher (auto mode).
        const { server, port } = await startServer((req, res) => {
          if (req.url === '/echo') {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (c: string) => { body += c; });
            req.on('end', () => {
              res.setHeader('content-type', 'text/plain');
              res.end('echo:' + body);
            });
            return;
          }
          res.statusCode = 404;
          res.end();
        });

        try {
          const session = gjsHttp2.connect('http://localhost:' + port, { nativeDispatcher: 'force' });
          // 'connect' fires on the next microtask; await it.
          await new Promise<void>((resolve) => session.once('connect', () => resolve()));
          // alpnProtocol should report 'h2c' on the native client path.
          expect((session as unknown as { alpnProtocol: string }).alpnProtocol).toBe('h2c');

          const stream = session.request({
            ':method': 'POST',
            ':path': '/echo',
            'content-type': 'text/plain',
          });
          let responseStatus: string | null = null;
          stream.on('response', (headers: Record<string, string | string[]>) => {
            responseStatus = String(headers[':status']);
          });
          stream.write(Buffer.from('payload-123'));
          stream.end();

          const chunks: string[] = [];
          for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
            chunks.push(chunk.toString('utf8'));
          }
          expect(responseStatus).toBe('200');
          expect(chunks.join('')).toBe('echo:payload-123');

          session.close();
        } finally {
          await closeServer(server);
        }
      });

      await it('Phase 3 — client receives server-pushed streams via "stream" event', async () => {
        const { server, port } = await startServer((_req, res) => {
          (res as any).stream.pushStream(
            { ':method': 'GET', ':scheme': 'http', ':authority': 'localhost', ':path': '/style.css' },
            (err: Error | null, pushedStream: any) => {
              if (err) { res.statusCode = 500; res.end(); return; }
              pushedStream.respond({ ':status': 200, 'content-type': 'text/css' });
              pushedStream.end('p { color: blue; }');
              res.setHeader('content-type', 'text/html');
              res.end('<html></html>');
            },
          );
        });

        try {
          const session = gjsHttp2.connect('http://localhost:' + port, { nativeDispatcher: 'force' });
          await new Promise<void>((resolve) => session.once('connect', () => resolve()));

          let pushedHeaders: Record<string, string | string[]> | null = null;
          let pushedBody: string | null = null;
          const pushReceived = new Promise<void>((resolve) => {
            (session as any).on('stream', async (pushed: any, headers: Record<string, string | string[]>) => {
              pushedHeaders = headers;
              const chunks: string[] = [];
              pushed.on('response', () => {});
              for await (const chunk of pushed as AsyncIterable<Buffer>) {
                chunks.push(chunk.toString('utf8'));
              }
              pushedBody = chunks.join('');
              resolve();
            });
          });

          const stream = session.request({ ':method': 'GET', ':path': '/' }, { endStream: true } as any);
          for await (const _c of stream as unknown as AsyncIterable<Buffer>) {
            // drain main response
            void _c;
          }
          await Promise.race([
            pushReceived,
            new Promise<void>((_r, reject) => setTimeout(() => reject(new Error('push timeout')), 5000)),
          ]);

          expect(pushedHeaders).not.toBe(null);
          expect(pushedHeaders![':path']).toBe('/style.css');
          expect(pushedBody).toBe('p { color: blue; }');

          session.close();
        } finally {
          await closeServer(server);
        }
      });

      await it('routes multiple concurrent streams on one connection', async () => {
        const { server, port } = await startServer((req, res) => {
          res.setHeader('content-type', 'text/plain');
          res.end('answer for ' + req.url);
        });

        const fx = openClient(port);
        try {
          const results = new Map<number, string>();
          let doneCount = 0;
          fx.client.connect('data_received', (_b: unknown, sid: number, chunk: any, endStream: boolean) => {
            if (chunk.get_size() > 0) {
              const prev = results.get(sid) ?? '';
              results.set(sid, prev + new TextDecoder().decode(chunk.get_data()));
            }
            if (endStream) doneCount++;
          });
          const ids: number[] = [];
          for (const path of ['/a', '/b', '/c']) {
            ids.push(fx.client.submit_request(
              [':method', ':scheme', ':authority', ':path'],
              ['GET', 'http', 'localhost', path],
              true,
            ));
          }
          pumpClient(fx);
          await waitFor(() => doneCount === 3, 5000);

          expect(results.get(ids[0])).toBe('answer for /a');
          expect(results.get(ids[1])).toBe('answer for /b');
          expect(results.get(ids[2])).toBe('answer for /c');
        } finally {
          closeClient(fx);
          await closeServer(server);
        }
      });
    });
  });
}
