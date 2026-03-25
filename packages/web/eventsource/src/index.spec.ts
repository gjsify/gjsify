// Tests for W3C EventSource (Server-Sent Events)
// Ported from refs/deno/tests/unit/ and refs/wpt/eventsource/
// Original: MIT license (Deno), 3-Clause BSD license (WPT)

import { describe, it, expect, on } from '@gjsify/unit';
import { EventSource, TextLineStream } from 'eventsource';

export default async () => {

  // ==================== TextLineStream ====================

  await describe('TextLineStream', async () => {
    await it('should split lines on \\n', async () => {
      const ts = new TextLineStream();
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      const lines: string[] = [];
      const [,] = await Promise.all([
        (async () => {
          await writer.write('hello\nworld\n');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lines.push(value);
          }
        })(),
      ]);

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('hello');
      expect(lines[1]).toBe('world');
    });

    await it('should split lines on \\r\\n', async () => {
      const ts = new TextLineStream();
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      const lines: string[] = [];
      await Promise.all([
        (async () => {
          await writer.write('foo\r\nbar\r\n');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lines.push(value);
          }
        })(),
      ]);

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('foo');
      expect(lines[1]).toBe('bar');
    });

    await it('should handle chunks split across writes', async () => {
      const ts = new TextLineStream();
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      const lines: string[] = [];
      await Promise.all([
        (async () => {
          await writer.write('hel');
          await writer.write('lo\nwor');
          await writer.write('ld\n');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lines.push(value);
          }
        })(),
      ]);

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('hello');
      expect(lines[1]).toBe('world');
    });

    await it('should flush remaining buffer on close', async () => {
      const ts = new TextLineStream();
      const writer = ts.writable.getWriter();
      const reader = ts.readable.getReader();

      const lines: string[] = [];
      await Promise.all([
        (async () => {
          await writer.write('no trailing newline');
          await writer.close();
        })(),
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lines.push(value);
          }
        })(),
      ]);

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('no trailing newline');
    });
  });

  // ==================== EventSource (static properties) ====================

  await describe('EventSource (static)', async () => {
    await it('should have CONNECTING, OPEN, CLOSED constants', async () => {
      expect(EventSource.CONNECTING).toBe(0);
      expect(EventSource.OPEN).toBe(1);
      expect(EventSource.CLOSED).toBe(2);
    });

    await it('should be a constructor', async () => {
      expect(typeof EventSource).toBe('function');
    });
  });

  // ==================== EventSource (constructor + integration) ====================
  // These tests create EventSource instances that connect via fetch,
  // which requires a Node.js HTTP server. Skipped on GJS.

  await on('Node.js', async () => {

  await describe('EventSource (constructor)', async () => {
    await it('should throw on invalid URL', async () => {
      let threw = false;
      try {
        new EventSource('not a valid url');
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should set url property', async () => {
      const es = new EventSource('http://localhost:9999/events');
      expect(es.url).toBe('http://localhost:9999/events');
      expect(es.readyState).toBe(EventSource.CONNECTING);
      expect(es.withCredentials).toBe(false);
      es.close();
    });

    await it('should have instance constants', async () => {
      const es = new EventSource('http://localhost:9999/events');
      expect(es.CONNECTING).toBe(0);
      expect(es.OPEN).toBe(1);
      expect(es.CLOSED).toBe(2);
      es.close();
    });

    await it('should set readyState to CLOSED after close()', async () => {
      const es = new EventSource('http://localhost:9999/events');
      es.close();
      expect(es.readyState).toBe(EventSource.CLOSED);
    });

    await it('should accept withCredentials option', async () => {
      const es = new EventSource('http://localhost:9999/events', { withCredentials: true });
      expect(es.withCredentials).toBe(true);
      es.close();
    });
  });

  // ==================== EventSource (event attributes) ====================

  await describe('EventSource (event attributes)', async () => {
    await it('should have null event handlers by default', async () => {
      const es = new EventSource('http://localhost:9999/events');
      expect(es.onopen).toBeNull();
      expect(es.onmessage).toBeNull();
      expect(es.onerror).toBeNull();
      es.close();
    });

    await it('should accept onopen assignment', async () => {
      const es = new EventSource('http://localhost:9999/events');
      const handler = () => {};
      es.onopen = handler;
      expect(es.onopen).toBe(handler);
      es.close();
    });

    await it('should accept onmessage assignment', async () => {
      const es = new EventSource('http://localhost:9999/events');
      const handler = () => {};
      es.onmessage = handler;
      expect(es.onmessage).toBe(handler);
      es.close();
    });

    await it('should accept onerror assignment', async () => {
      const es = new EventSource('http://localhost:9999/events');
      const handler = () => {};
      es.onerror = handler;
      expect(es.onerror).toBe(handler);
      es.close();
    });
  });

  // ==================== EventSource (integration with HTTP server) ====================

  await describe('EventSource (SSE integration)', async () => {

    // Helper to create a simple SSE server
    async function createSSEServer(handler: (req: any, res: any) => void): Promise<{ port: number; close: () => void }> {
      const http = await import('http');
      return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, () => {
          const addr = server.address() as any;
          resolve({
            port: addr.port,
            close: () => server.close(),
          });
        });
      });
    }

    await it('should receive a basic message', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.write('data: hello world\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const msg = await new Promise<MessageEvent>((resolve) => {
          es.onmessage = (e) => {
            resolve(e);
            es.close();
          };
          es.onerror = () => es.close();
        });
        expect(msg.data).toBe('hello world');
      } finally {
        server.close();
      }
    });

    await it('should receive named events', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.write('event: greeting\ndata: hi there\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const msg = await new Promise<MessageEvent>((resolve) => {
          es.addEventListener('greeting', (e) => {
            resolve(e as MessageEvent);
            es.close();
          });
          es.onerror = () => es.close();
        });
        expect(msg.data).toBe('hi there');
      } finally {
        server.close();
      }
    });

    await it('should receive multi-line data', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.write('data: line1\ndata: line2\ndata: line3\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const msg = await new Promise<MessageEvent>((resolve) => {
          es.onmessage = (e) => {
            resolve(e);
            es.close();
          };
          es.onerror = () => es.close();
        });
        expect(msg.data).toBe('line1\nline2\nline3');
      } finally {
        server.close();
      }
    });

    await it('should receive multiple messages', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.write('data: msg1\n\ndata: msg2\n\ndata: msg3\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const msgs: string[] = [];
        await new Promise<void>((resolve) => {
          es.onmessage = (e) => {
            msgs.push(e.data);
            if (msgs.length === 3) {
              es.close();
              resolve();
            }
          };
          es.onerror = () => { es.close(); resolve(); };
        });
        expect(msgs.length).toBe(3);
        expect(msgs[0]).toBe('msg1');
        expect(msgs[1]).toBe('msg2');
        expect(msgs[2]).toBe('msg3');
      } finally {
        server.close();
      }
    });

    await it('should ignore comment lines', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.write(': this is a comment\ndata: actual data\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const msg = await new Promise<MessageEvent>((resolve) => {
          es.onmessage = (e) => {
            resolve(e);
            es.close();
          };
          es.onerror = () => es.close();
        });
        expect(msg.data).toBe('actual data');
      } finally {
        server.close();
      }
    });

    await it('should track lastEventId', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.write('id: 42\ndata: with id\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const msg = await new Promise<MessageEvent>((resolve) => {
          es.onmessage = (e) => {
            resolve(e);
            es.close();
          };
          es.onerror = () => es.close();
        });
        expect(msg.data).toBe('with id');
        expect(msg.lastEventId).toBe('42');
      } finally {
        server.close();
      }
    });

    await it('should fire open event', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.write('data: hi\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const opened = await new Promise<boolean>((resolve) => {
          es.onopen = () => {
            resolve(true);
            es.close();
          };
          es.onerror = () => { es.close(); resolve(false); };
        });
        expect(opened).toBe(true);
      } finally {
        server.close();
      }
    });

    await it('should fire error on non-200 status', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(404);
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const gotError = await new Promise<boolean>((resolve) => {
          es.onerror = () => {
            resolve(true);
            es.close();
          };
          setTimeout(() => { es.close(); resolve(false); }, 3000);
        });
        expect(gotError).toBe(true);
        expect(es.readyState).toBe(EventSource.CLOSED);
      } finally {
        server.close();
      }
    });

    await it('should fire error on wrong content-type', async () => {
      const server = await createSSEServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('data: nope\n\n');
        res.end();
      });

      try {
        const es = new EventSource(`http://localhost:${server.port}/events`);
        const gotError = await new Promise<boolean>((resolve) => {
          es.onerror = () => {
            resolve(true);
            es.close();
          };
          setTimeout(() => { es.close(); resolve(false); }, 3000);
        });
        expect(gotError).toBe(true);
      } finally {
        server.close();
      }
    });
  });

  }); // end on('Node.js')
};
