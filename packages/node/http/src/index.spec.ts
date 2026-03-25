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
  });

  // --- STATUS_CODES ---
  await describe('http.STATUS_CODES', async () => {
    await it('should be an object', async () => {
      expect(typeof http.STATUS_CODES).toBe('object');
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
  });

  // --- Module exports ---
  await describe('http module exports', async () => {
    await it('should export maxHeaderSize', async () => {
      expect(http.maxHeaderSize).toBe(16384);
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

  // --- IncomingMessage ---
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
  });
};
