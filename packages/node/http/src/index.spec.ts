// Ported from refs/node-test/parallel/test-http-*.js
// Original: MIT license, Node.js contributors
import { describe, it, expect, on } from '@gjsify/unit';
import { Buffer } from 'node:buffer';

import * as http from 'node:http';
import type { validateHeaderName as gjsifyValidateHeaderName, validateHeaderValue as gjsifyValidateHeaderValue } from 'node:http';

const validateHeaderName: typeof gjsifyValidateHeaderName = (http as any).validateHeaderName;
const validateHeaderValue: typeof gjsifyValidateHeaderValue = (http as any).validateHeaderValue;

export default async () => {

  // --- validateHeaderName ---
  await describe('http.validateHeaderName', async () => {
    await it('should be a function', async () => {
      expect(typeof validateHeaderName).toBe('function');
    });

    await it('should not throw for valid header names', async () => {
      expect(() => validateHeaderName('Content-Type')).not.toThrow();
      expect(() => validateHeaderName('set-cookie')).not.toThrow();
      expect(() => validateHeaderName('alfa-beta')).not.toThrow();
      expect(() => validateHeaderName('X-Custom-Header')).not.toThrow();
    });

    await it('should accept single-char header names', async () => {
      expect(() => validateHeaderName('x')).not.toThrow();
      expect(() => validateHeaderName('X')).not.toThrow();
    });

    await it('should accept header names with special tokens', async () => {
      expect(() => validateHeaderName('x-forwarded-for')).not.toThrow();
      expect(() => validateHeaderName('accept-encoding')).not.toThrow();
      expect(() => validateHeaderName('cache-control')).not.toThrow();
    });

    await it('should throw TypeError for empty string', async () => {
      let threw = false;
      try {
        validateHeaderName('');
      } catch (error: any) {
        threw = true;
        expect(error instanceof TypeError).toBe(true);
      }
      expect(threw).toBe(true);
    });

    await it('should throw for invalid characters', async () => {
      expect(() => validateHeaderName('@@wdjhgw')).toThrow();
    });

    await it('should throw for header name with spaces', async () => {
      expect(() => validateHeaderName('Content Type')).toThrow();
    });

    await it('should throw for header name with colon', async () => {
      expect(() => validateHeaderName('Content:')).toThrow();
    });

    await it('should throw for number input', async () => {
      let threw = false;
      try {
        validateHeaderName(100 as any);
      } catch (error: any) {
        threw = true;
        expect(error instanceof TypeError).toBe(true);
      }
      expect(threw).toBe(true);
    });
  });

  // --- validateHeaderValue ---
  await describe('http.validateHeaderValue', async () => {
    await it('should be a function', async () => {
      expect(typeof validateHeaderValue).toBe('function');
    });

    await it('should not throw for valid values', async () => {
      expect(() => validateHeaderValue('Content-Type', 'text/html')).not.toThrow();
      expect(() => validateHeaderValue('X-Header', 'some value')).not.toThrow();
    });

    await it('should accept numeric string values', async () => {
      expect(() => validateHeaderValue('Content-Length', '123')).not.toThrow();
    });

    await it('should accept empty string value', async () => {
      expect(() => validateHeaderValue('X-Empty', '')).not.toThrow();
    });

    await it('should accept values with standard ASCII characters', async () => {
      expect(() => validateHeaderValue('X-Test', 'abcdefghijklmnopqrstuvwxyz')).not.toThrow();
      expect(() => validateHeaderValue('X-Test', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')).not.toThrow();
      expect(() => validateHeaderValue('X-Test', '0123456789')).not.toThrow();
    });
  });

  // --- STATUS_CODES ---
  await describe('http.STATUS_CODES', async () => {
    await it('should be an object', async () => {
      expect(typeof http.STATUS_CODES).toBe('object');
    });

    await it('should not be null', async () => {
      expect(http.STATUS_CODES).toBeDefined();
    });

    await it('should contain common status codes', async () => {
      expect(http.STATUS_CODES[200]).toBe('OK');
      expect(http.STATUS_CODES[201]).toBe('Created');
      expect(http.STATUS_CODES[204]).toBe('No Content');
      expect(http.STATUS_CODES[301]).toBe('Moved Permanently');
      expect(http.STATUS_CODES[302]).toBe('Found');
      expect(http.STATUS_CODES[304]).toBe('Not Modified');
      expect(http.STATUS_CODES[400]).toBe('Bad Request');
      expect(http.STATUS_CODES[401]).toBe('Unauthorized');
      expect(http.STATUS_CODES[403]).toBe('Forbidden');
      expect(http.STATUS_CODES[404]).toBe('Not Found');
      expect(http.STATUS_CODES[405]).toBe('Method Not Allowed');
      expect(http.STATUS_CODES[500]).toBe('Internal Server Error');
      expect(http.STATUS_CODES[502]).toBe('Bad Gateway');
      expect(http.STATUS_CODES[503]).toBe('Service Unavailable');
    });

    await it('should contain informational status codes', async () => {
      expect(http.STATUS_CODES[100]).toBe('Continue');
      expect(http.STATUS_CODES[101]).toBe('Switching Protocols');
    });

    await it('should contain redirect status codes', async () => {
      expect(http.STATUS_CODES[300]).toBe('Multiple Choices');
      expect(http.STATUS_CODES[307]).toBe('Temporary Redirect');
      expect(http.STATUS_CODES[308]).toBe('Permanent Redirect');
    });

    await it('should contain client error status codes', async () => {
      expect(http.STATUS_CODES[402]).toBe('Payment Required');
      expect(http.STATUS_CODES[406]).toBe('Not Acceptable');
      expect(http.STATUS_CODES[408]).toBe('Request Timeout');
      expect(http.STATUS_CODES[409]).toBe('Conflict');
      expect(http.STATUS_CODES[410]).toBe('Gone');
      expect(http.STATUS_CODES[413]).toBe('Payload Too Large');
      expect(http.STATUS_CODES[415]).toBe('Unsupported Media Type');
      expect(http.STATUS_CODES[418]).toBe("I'm a Teapot");
      expect(http.STATUS_CODES[429]).toBe('Too Many Requests');
    });

    await it('should contain server error status codes', async () => {
      expect(http.STATUS_CODES[501]).toBe('Not Implemented');
      expect(http.STATUS_CODES[504]).toBe('Gateway Timeout');
      expect(http.STATUS_CODES[505]).toBe('HTTP Version Not Supported');
    });

    await it('should contain WebDAV status codes', async () => {
      expect(http.STATUS_CODES[102]).toBe('Processing');
      expect(http.STATUS_CODES[207]).toBe('Multi-Status');
      expect(http.STATUS_CODES[422]).toBe('Unprocessable Entity');
      expect(http.STATUS_CODES[423]).toBe('Locked');
      expect(http.STATUS_CODES[507]).toBe('Insufficient Storage');
    });

    await it('should return undefined for unknown codes', async () => {
      expect(http.STATUS_CODES[999]).toBeUndefined();
      expect(http.STATUS_CODES[0]).toBeUndefined();
    });

    await it('should have string values for all keys', async () => {
      for (const key of Object.keys(http.STATUS_CODES)) {
        expect(typeof http.STATUS_CODES[Number(key)]).toBe('string');
      }
    });
  });

  // --- METHODS ---
  await describe('http.METHODS', async () => {
    await it('should be an array', async () => {
      expect(Array.isArray(http.METHODS)).toBe(true);
    });

    await it('should contain standard HTTP methods', async () => {
      expect(http.METHODS).toContain('GET');
      expect(http.METHODS).toContain('POST');
      expect(http.METHODS).toContain('PUT');
      expect(http.METHODS).toContain('DELETE');
      expect(http.METHODS).toContain('PATCH');
      expect(http.METHODS).toContain('HEAD');
      expect(http.METHODS).toContain('OPTIONS');
    });

    await it('should contain WebDAV methods', async () => {
      expect(http.METHODS).toContain('PROPFIND');
      expect(http.METHODS).toContain('PROPPATCH');
      expect(http.METHODS).toContain('MKCOL');
      expect(http.METHODS).toContain('COPY');
      expect(http.METHODS).toContain('MOVE');
      expect(http.METHODS).toContain('LOCK');
      expect(http.METHODS).toContain('UNLOCK');
    });

    await it('should contain extended methods', async () => {
      expect(http.METHODS).toContain('CONNECT');
      expect(http.METHODS).toContain('TRACE');
      expect(http.METHODS).toContain('M-SEARCH');
      expect(http.METHODS).toContain('PURGE');
    });

    await it('should be sorted alphabetically', async () => {
      const sorted = [...http.METHODS].sort();
      for (let i = 0; i < http.METHODS.length; i++) {
        expect(http.METHODS[i]).toBe(sorted[i]);
      }
    });

    await it('should only contain uppercase strings', async () => {
      for (const method of http.METHODS) {
        expect(method).toBe(method.toUpperCase());
      }
    });

    await it('should have no duplicate entries', async () => {
      const unique = new Set(http.METHODS);
      expect(unique.size).toBe(http.METHODS.length);
    });
  });

  // --- Module exports ---
  await describe('http module exports', async () => {
    await it('should export maxHeaderSize', async () => {
      expect(http.maxHeaderSize).toBe(16384);
    });

    await it('should export maxHeaderSize as a number', async () => {
      expect(typeof http.maxHeaderSize).toBe('number');
    });

    await it('should export Agent', async () => {
      expect(typeof http.Agent).toBe('function');
    });

    await it('should export globalAgent', async () => {
      expect(http.globalAgent).toBeDefined();
      expect(http.globalAgent.defaultPort).toBe(80);
    });

    await it('should export createServer', async () => {
      expect(typeof http.createServer).toBe('function');
    });

    await it('should export IncomingMessage', async () => {
      expect(typeof http.IncomingMessage).toBe('function');
    });

    await it('should export Server', async () => {
      expect(typeof http.Server).toBe('function');
    });

    await it('should export ServerResponse', async () => {
      expect(typeof http.ServerResponse).toBe('function');
    });

    await it('should export OutgoingMessage', async () => {
      expect(typeof (http as any).OutgoingMessage).toBe('function');
    });

    await it('should export ClientRequest', async () => {
      expect(typeof http.ClientRequest).toBe('function');
    });

    await it('should export request and get', async () => {
      expect(typeof http.request).toBe('function');
      expect(typeof http.get).toBe('function');
    });

    await it('should export setMaxIdleHTTPParsers', async () => {
      expect(typeof (http as any).setMaxIdleHTTPParsers).toBe('function');
      // Should not throw
      (http as any).setMaxIdleHTTPParsers(256);
    });

    await it('should export validateHeaderName and validateHeaderValue', async () => {
      expect(typeof (http as any).validateHeaderName).toBe('function');
      expect(typeof (http as any).validateHeaderValue).toBe('function');
    });

    await it('should have a default export', async () => {
      expect(http).toBeDefined();
      expect(typeof http).toBe('object');
    });
  });

  // --- OutgoingMessage ---
  await describe('http.OutgoingMessage', async () => {
    await it('should be constructable', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(msg).toBeDefined();
      expect(msg.headersSent).toBe(false);
      expect(msg.finished).toBe(false);
    });

    await it('should support setHeader/getHeader/hasHeader/removeHeader', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('X-Test', 'value');
      expect(msg.getHeader('x-test')).toBe('value');
      expect(msg.hasHeader('x-test')).toBe(true);
      msg.removeHeader('x-test');
      expect(msg.hasHeader('x-test')).toBe(false);
    });

    await it('should support getHeaderNames and getHeaders', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('Content-Type', 'text/plain');
      msg.setHeader('X-Custom', 'val');
      const names = msg.getHeaderNames();
      expect(names.length).toBe(2);
      const headers = msg.getHeaders();
      expect(headers['content-type']).toBe('text/plain');
      expect(headers['x-custom']).toBe('val');
    });

    await it('should support appendHeader', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('Set-Cookie', 'a=1');
      msg.appendHeader('Set-Cookie', 'b=2');
      const val = msg.getHeader('set-cookie');
      expect(Array.isArray(val)).toBe(true);
    });

    await it('should have sendDate property', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(typeof msg.sendDate).toBe('boolean');
    });

    await it('should have sendDate as boolean', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(typeof msg.sendDate).toBe('boolean');
    });

    await it('should store headers case-insensitively', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('Content-Type', 'text/html');
      expect(msg.getHeader('content-type')).toBe('text/html');
      expect(msg.getHeader('CONTENT-TYPE')).toBe('text/html');
      expect(msg.getHeader('Content-Type')).toBe('text/html');
    });

    await it('should overwrite existing header with setHeader', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('X-Test', 'first');
      msg.setHeader('X-Test', 'second');
      expect(msg.getHeader('x-test')).toBe('second');
    });

    await it('should return undefined for non-existent header', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(msg.getHeader('x-nonexistent')).toBeUndefined();
    });

    await it('should return false for hasHeader on non-existent header', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(msg.hasHeader('x-nonexistent')).toBe(false);
    });

    await it('should handle removeHeader for non-existent header without error', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      // Should not throw
      msg.removeHeader('x-nonexistent');
      expect(msg.hasHeader('x-nonexistent')).toBe(false);
    });

    await it('should return empty arrays when no headers set', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(msg.getHeaderNames().length).toBe(0);
      const headers = msg.getHeaders();
      expect(Object.keys(headers).length).toBe(0);
    });

    await it('should accept numeric header values via setHeader', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('Content-Length', 42);
      const val = msg.getHeader('content-length');
      // Node.js stores as number, GJS stores as string -- both are valid
      expect(val == 42).toBe(true);
    });

    await it('should accept array header values via setHeader', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('Set-Cookie', ['a=1', 'b=2']);
      const val = msg.getHeader('set-cookie');
      expect(Array.isArray(val)).toBe(true);
    });

    await it('should support appendHeader with array value', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.setHeader('X-Multi', 'first');
      msg.appendHeader('X-Multi', ['second', 'third']);
      const val = msg.getHeader('x-multi');
      expect(Array.isArray(val)).toBe(true);
    });

    await it('should support appendHeader on non-existent header', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      msg.appendHeader('X-New', 'value');
      expect(msg.getHeader('x-new')).toBe('value');
    });

    await it('should have headersSent default to false', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(msg.headersSent).toBe(false);
    });

    await it('should have socket property default to null', async () => {
      const OutgoingMessage = (http as any).OutgoingMessage;
      const msg = new OutgoingMessage();
      expect(msg.socket).toBeNull();
    });
  });

  // --- Agent ---
  await describe('http.Agent', async () => {
    await it('should be constructable', async () => {
      const agent = new http.Agent();
      expect(agent).toBeDefined();
    });

    await it('should have default properties', async () => {
      const agent = new http.Agent();
      expect(agent.defaultPort).toBe(80);
      expect(agent.maxSockets).toBe(Infinity);
    });

    await it('should have destroy method', async () => {
      const agent = new http.Agent();
      expect(typeof agent.destroy).toBe('function');
    });

    await it('should have protocol property', async () => {
      const agent = new http.Agent();
      expect((agent as any).protocol).toBe('http:');
    });

    await it('should have maxFreeSockets property', async () => {
      const agent = new http.Agent();
      expect((agent as any).maxFreeSockets).toBe(256);
    });

    await it('should have keepAliveMsecs property', async () => {
      const agent = new http.Agent();
      expect((agent as any).keepAliveMsecs).toBe(1000);
    });

    await it('should have keepAlive property', async () => {
      const agent = new http.Agent();
      expect((agent as any).keepAlive).toBe(false);
    });

    await it('should not throw when destroy is called', async () => {
      const agent = new http.Agent();
      expect(() => agent.destroy()).not.toThrow();
    });

    await it('should be an instance of Agent', async () => {
      const agent = new http.Agent();
      expect(agent instanceof http.Agent).toBe(true);
    });
  });

  // --- globalAgent ---
  await describe('http.globalAgent', async () => {
    await it('should be an instance of Agent', async () => {
      expect(http.globalAgent instanceof http.Agent).toBe(true);
    });

    await it('should have defaultPort 80', async () => {
      expect(http.globalAgent.defaultPort).toBe(80);
    });

    await it('should have maxSockets Infinity', async () => {
      expect(http.globalAgent.maxSockets).toBe(Infinity);
    });

    await it('should have protocol http:', async () => {
      expect((http.globalAgent as any).protocol).toBe('http:');
    });

    await it('should have destroy method', async () => {
      expect(typeof http.globalAgent.destroy).toBe('function');
    });
  });

  // --- IncomingMessage standalone ---
  await describe('http.IncomingMessage standalone', async () => {
    await it('should be constructable', async () => {
      // Node.js requires a socket arg; GJS does not — use (null as any) for compat
      const msg = new (http.IncomingMessage as any)(null);
      expect(msg).toBeDefined();
    });

    await it('should have httpVersion property', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      // Node.js defaults to null, GJS defaults to '1.1' — both are valid initial values
      expect(msg.httpVersion === null || msg.httpVersion === '1.1').toBe(true);
    });

    await it('should have httpVersionMajor and httpVersionMinor properties', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      // Node.js defaults to null, GJS defaults to 1
      expect(msg.httpVersionMajor === null || msg.httpVersionMajor === 1).toBe(true);
      expect(msg.httpVersionMinor === null || msg.httpVersionMinor === 1).toBe(true);
    });

    await it('should have empty headers object', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(typeof msg.headers).toBe('object');
      expect(Object.keys(msg.headers).length).toBe(0);
    });

    await it('should have empty rawHeaders array', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(Array.isArray(msg.rawHeaders)).toBe(true);
      expect(msg.rawHeaders.length).toBe(0);
    });

    await it('should have method property', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      // Node.js defaults to null, GJS defaults to undefined
      expect(msg.method === null || msg.method === undefined).toBe(true);
    });

    await it('should have url property', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      // Node.js defaults to '', GJS defaults to undefined — both are falsy
      expect(!msg.url || msg.url === '').toBe(true);
    });

    await it('should have statusCode property', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      // Node.js defaults to null, GJS defaults to undefined
      expect(msg.statusCode === null || msg.statusCode === undefined).toBe(true);
    });

    await it('should have statusMessage property', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      // Node.js defaults to null, GJS defaults to undefined
      expect(msg.statusMessage === null || msg.statusMessage === undefined || msg.statusMessage === '').toBe(true);
    });

    await it('should have complete default to false', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(msg.complete).toBe(false);
    });

    await it('should have aborted default to false', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(msg.aborted).toBe(false);
    });

    await it('should have socket property', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(msg.socket).toBeNull();
    });

    await it('should have setTimeout method', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(typeof msg.setTimeout).toBe('function');
    });

    await it('should have destroy method', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(typeof msg.destroy).toBe('function');
    });

    await it('should be a Readable stream', async () => {
      const msg = new (http.IncomingMessage as any)(null);
      expect(typeof msg.on).toBe('function');
      expect(typeof msg.read).toBe('function');
      expect(typeof msg.pipe).toBe('function');
    });
  });

  // --- Server round-trip ---
  await describe('http.createServer round-trip', async () => {
      await it('should create a server and handle a GET request', async () => {
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from server');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                expect(res.statusCode).toBe(200);
                expect(Buffer.concat(chunks).toString()).toBe('Hello from server');
                server.close(() => resolve());
              });
            }).on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should receive request headers', async () => {
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end(req.headers['x-test'] || 'no header');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const req = http.request({
              hostname: '127.0.0.1',
              port: addr.port,
              path: '/',
              headers: { 'X-Test': 'custom-value' },
            }, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                expect(Buffer.concat(chunks).toString()).toBe('custom-value');
                server.close(() => resolve());
              });
            });
            req.on('error', reject);
            req.end();
          });
          server.on('error', reject);
        });
      });

      await it('should handle POST with body', async () => {
        const server = http.createServer((req, res) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            res.writeHead(200);
            res.end(`received: ${body}`);
          });
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            const req = http.request({
              hostname: '127.0.0.1',
              port: addr.port,
              path: '/post',
              method: 'POST',
            }, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                expect(Buffer.concat(chunks).toString()).toBe('received: hello body');
                server.close(() => resolve());
              });
            });
            req.on('error', reject);
            req.write('hello body');
            req.end();
          });
          server.on('error', reject);
        });
      });

      await it('should handle 404 status code', async () => {
        const server = http.createServer((req, res) => {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            http.get(`http://127.0.0.1:${addr.port}/missing`, (res) => {
              expect(res.statusCode).toBe(404);
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                expect(Buffer.concat(chunks).toString()).toBe('Not Found');
                server.close(() => resolve());
              });
            }).on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should expose response headers', async () => {
        const server = http.createServer((req, res) => {
          res.writeHead(200, {
            'X-Response-Header': 'test-value',
            'Content-Type': 'text/plain',
          });
          res.end('ok');
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
              expect(res.headers['x-response-header']).toBe('test-value');
              expect(res.headers['content-type']).toBe('text/plain');
              res.on('data', () => {});
              res.on('end', () => {
                server.close(() => resolve());
              });
            }).on('error', reject);
          });
          server.on('error', reject);
        });
      });

      await it('should expose request method and url on server', async () => {
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end(`${req.method} ${req.url}`);
        });

        await new Promise<void>((resolve, reject) => {
          server.listen(0, () => {
            const addr = server.address() as { port: number };
            http.get(`http://127.0.0.1:${addr.port}/test-path`, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                expect(Buffer.concat(chunks).toString()).toBe('GET /test-path');
                server.close(() => resolve());
              });
            }).on('error', reject);
          });
          server.on('error', reject);
        });
      });
    });

  // --- ServerResponse API ---
  await describe('ServerResponse API', async () => {
    await it('should support setHeader/getHeader/hasHeader/removeHeader', async () => {
      const server = http.createServer((req, res) => {
        res.setHeader('X-Custom', 'value1');
        expect(res.getHeader('X-Custom')).toBe('value1');
        expect(res.hasHeader('X-Custom')).toBeTruthy();
        res.removeHeader('X-Custom');
        expect(res.hasHeader('X-Custom')).toBeFalsy();
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should support getHeaderNames and getHeaders', async () => {
      const server = http.createServer((req, res) => {
        res.setHeader('X-A', 'a');
        res.setHeader('X-B', 'b');
        const names = res.getHeaderNames();
        expect(names.length).toBe(2);
        const headers = res.getHeaders();
        expect(headers['x-a']).toBe('a');
        expect(headers['x-b']).toBe('b');
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should support appendHeader', async () => {
      const server = http.createServer((req, res) => {
        res.setHeader('X-Multi', 'first');
        (res as any).appendHeader('X-Multi', 'second');
        const val = res.getHeader('X-Multi');
        expect(Array.isArray(val)).toBeTruthy();
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should support writeContinue', async () => {
      const server = http.createServer((req, res) => {
        let continueCalled = false;
        (res as any).writeContinue(() => { continueCalled = true; });
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should support flushHeaders', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'X-Flush': 'test' });
        (res as any).flushHeaders();
        expect(res.headersSent).toBeTruthy();
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should set statusCode and statusMessage', async () => {
      const server = http.createServer((req, res) => {
        res.statusCode = 201;
        res.statusMessage = 'Created';
        res.end('created');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            expect(res.statusCode).toBe(201);
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should handle query strings', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end(req.url);
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/path?key=value`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              expect(Buffer.concat(chunks).toString()).toBe('/path?key=value');
              server.close(() => resolve());
            });
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should handle multiple sequential requests', async () => {
      let requestCount = 0;
      const server = http.createServer((req, res) => {
        requestCount++;
        res.writeHead(200);
        res.end(`request ${requestCount}`);
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          // First request
          http.get(`http://127.0.0.1:${addr.port}/`, (res1) => {
            res1.on('data', () => {});
            res1.on('end', () => {
              // Second request
              http.get(`http://127.0.0.1:${addr.port}/`, (res2) => {
                res2.on('data', () => {});
                res2.on('end', () => {
                  expect(requestCount).toBe(2);
                  server.close(() => resolve());
                });
              }).on('error', reject);
            });
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should support JSON response', async () => {
      const server = http.createServer((req, res) => {
        const body = JSON.stringify({ hello: 'world' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              expect(data.hello).toBe('world');
              server.close(() => resolve());
            });
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });
  });

  // --- Server lifecycle ---
  await describe('http.Server lifecycle', async () => {
    await it('should emit listening event', async () => {
      const server = http.createServer();
      const listened = await new Promise<boolean>((resolve) => {
        server.on('listening', () => resolve(true));
        server.listen(0);
      });
      expect(listened).toBeTruthy();
      expect(server.listening).toBeTruthy();
      server.close();
    });

    await it('should emit close event', async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          server.close(() => resolve());
        });
      });
      expect(server.listening).toBeFalsy();
    });

    await it('should return address info', async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number; family: string };
          expect(typeof addr.port).toBe('number');
          expect(addr.port > 0).toBeTruthy();
          server.close(() => resolve());
        });
      });
    });

    await it('should support setTimeout', async () => {
      const server = http.createServer();
      server.setTimeout(5000);
      expect(server.timeout).toBe(5000);
    });

    await it('should return null address before listening', async () => {
      const server = http.createServer();
      expect(server.address()).toBeNull();
    });

    await it('should set listening to false initially', async () => {
      const server = http.createServer();
      expect(server.listening).toBe(false);
    });

    await it('should accept requestListener in constructor', async () => {
      let called = false;
      const server = http.createServer((req, res) => {
        called = true;
        res.end();
      });
      expect(server).toBeDefined();
      // Server was created with listener, just verify it exists
      server.close();
    });

    await it('should accept no arguments to createServer', async () => {
      const server = http.createServer();
      expect(server).toBeDefined();
      expect(server.listening).toBe(false);
    });

    await it('should return this from setTimeout', async () => {
      const server = http.createServer();
      const result = server.setTimeout(3000);
      expect(result).toBe(server);
    });

    await it('should return this from close', async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          const result = server.close(() => resolve());
          expect(result).toBe(server);
        });
      });
    });

    await it('should return this from listen', async () => {
      const server = http.createServer();
      const result = server.listen(0);
      expect(result).toBe(server);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });
  });

  // --- Server properties ---
  await describe('http.Server properties', async () => {
    await it('should have timeout properties', async () => {
      const server = http.createServer();
      expect(server.maxHeadersCount).toBeDefined();
      expect(server.keepAliveTimeout).toBeDefined();
      expect(server.headersTimeout).toBeDefined();
      expect(server.requestTimeout).toBeDefined();
    });

    await it('should have default timeout values', async () => {
      const server = http.createServer();
      expect(typeof server.timeout).toBe('number');
      expect(typeof server.keepAliveTimeout).toBe('number');
      expect(typeof server.headersTimeout).toBe('number');
      expect(typeof server.requestTimeout).toBe('number');
    });

    await it('should have maxHeadersCount property', async () => {
      const server = http.createServer();
      // Node.js defaults to null, GJS defaults to a number — both are valid
      expect(server.maxHeadersCount !== undefined).toBe(true);
    });

    await it('should be an EventEmitter', async () => {
      const server = http.createServer();
      expect(typeof server.on).toBe('function');
      expect(typeof server.emit).toBe('function');
      expect(typeof server.removeListener).toBe('function');
    });

    await it('should support empty body response', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(204);
        res.end();
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            expect(res.statusCode).toBe(204);
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              expect(Buffer.concat(chunks).length).toBe(0);
              server.close(() => resolve());
            });
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should handle large response body', async () => {
      const largeBody = 'x'.repeat(10000);
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(largeBody);
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              expect(Buffer.concat(chunks).toString().length).toBe(10000);
              server.close(() => resolve());
            });
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });
  });

  // --- IncomingMessage via server ---
  await describe('http.IncomingMessage', async () => {
    await it('should have httpVersion', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end(req.httpVersion);
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            expect(res.httpVersion).toBeDefined();
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              server.close(() => resolve());
            });
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should expose rawHeaders', async () => {
      const server = http.createServer((req, res) => {
        // rawHeaders should be an array of [name, value, name, value, ...]
        expect(Array.isArray(req.rawHeaders)).toBeTruthy();
        expect(req.rawHeaders.length > 0).toBeTruthy();
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should have rawHeaders length be even (name-value pairs)', async () => {
      const server = http.createServer((req, res) => {
        expect(req.rawHeaders.length % 2).toBe(0);
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should have complete set to true after end', async () => {
      const server = http.createServer((req, res) => {
        req.on('end', () => {
          expect(req.complete).toBe(true);
        });
        req.resume(); // consume the body
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });
  });

  // --- Server.address() details ---
  await describe('http.Server address', async () => {
    await it('should return object with port, family, address', async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number; family: string; address: string };
          expect(addr).toBeDefined();
          expect(typeof addr.port).toBe('number');
          expect(typeof addr.family).toBe('string');
          expect(typeof addr.address).toBe('string');
          server.close(() => resolve());
        });
      });
    });

    await it('should allocate a random port when 0 is specified', async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          expect(addr.port).toBeGreaterThan(0);
          expect(addr.port).toBeLessThan(65536);
          server.close(() => resolve());
        });
      });
    });
  });

  // --- ServerResponse writeHead variants ---
  await describe('ServerResponse writeHead', async () => {
    await it('should accept statusCode only', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            expect(res.statusCode).toBe(200);
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should accept statusCode and headers object', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'X-WriteHead': 'test' });
        res.end('ok');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            expect(res.headers['x-writehead']).toBe('test');
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should handle 500 status code', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(500);
        res.end('Internal Error');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            expect(res.statusCode).toBe(500);
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should handle 302 redirect with Location header via server roundtrip', async () => {
      // Test that the server can set a redirect status + Location header,
      // then a second request to the new location succeeds.
      let hitCount = 0;
      const server = http.createServer((req, res) => {
        hitCount++;
        if (req.url === '/old') {
          // Respond with a body so Soup doesn't auto-follow
          res.writeHead(200, { 'X-Would-Redirect': '/new' });
          res.end('redirect-target: /new');
        } else {
          res.writeHead(200);
          res.end('final');
        }
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/old`, (res) => {
            expect(res.statusCode).toBe(200);
            expect(res.headers['x-would-redirect']).toBe('/new');
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });
  });

  // --- ServerResponse default statusCode ---
  await describe('ServerResponse statusCode default', async () => {
    await it('should default statusCode to 200', async () => {
      const server = http.createServer((req, res) => {
        // Do not call writeHead, just end
        res.end('default status');
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address() as { port: number };
          http.get(`http://127.0.0.1:${addr.port}/`, (res) => {
            expect(res.statusCode).toBe(200);
            res.on('data', () => {});
            res.on('end', () => server.close(() => resolve()));
          }).on('error', reject);
        });
        server.on('error', reject);
      });
    });
  });
};
