import { describe, it, expect, on } from '@gjsify/unit';

import * as http from 'http';
import type { validateHeaderName as gjsifyValidateHeaderName, validateHeaderValue as gjsifyValidateHeaderValue } from './index.js';

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

    await it('should export request and get', async () => {
      expect(typeof http.request).toBe('function');
      expect(typeof http.get).toBe('function');
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

  // --- Server round-trip (Node.js only) ---
  await on('Node.js', async () => {
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
  });
};
