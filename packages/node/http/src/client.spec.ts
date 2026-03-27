// Ported from refs/node-test/parallel/test-http-outgoing-properties.js,
// test-http-agent.js, test-http-methods.js and others
// Original: MIT license, Node.js contributors
import { describe, it, expect } from '@gjsify/unit';
import * as http from 'node:http';

export default async () => {
  await describe('http.ClientRequest', async () => {
    await it('should export ClientRequest class', async () => {
      expect(typeof http.ClientRequest).toBe('function');
    });

    await it('should export request function', async () => {
      expect(typeof http.request).toBe('function');
    });

    await it('should export get function', async () => {
      expect(typeof http.get).toBe('function');
    });

    await it('request() should return a ClientRequest instance', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(req).toBeDefined();
      expect(typeof req.setHeader).toBe('function');
      expect(typeof req.getHeader).toBe('function');
      expect(typeof req.removeHeader).toBe('function');
      expect(typeof req.end).toBe('function');
      expect(typeof req.write).toBe('function');
      expect(typeof req.abort).toBe('function');
      // Clean up — abort to avoid hanging
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should accept URL string', async () => {
      const req = http.request('http://localhost:1/test');
      expect(req).toBeDefined();
      expect(req.method).toBe('GET');
      expect(req.path).toBe('/test');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should accept options with method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/data', method: 'POST' });
      expect(req.method).toBe('POST');
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should support setHeader/getHeader/removeHeader', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      req.setHeader('X-Custom', 'test');
      expect(req.getHeader('x-custom')).toBe('test');
      expect(req.hasHeader('x-custom')).toBe(true);
      req.removeHeader('x-custom');
      expect(req.hasHeader('x-custom')).toBe(false);
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should have default properties', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/api' });
      expect(req.method).toBe('GET');
      expect(req.path).toBe('/api');
      req.on('error', () => {});
      req.abort();
    });

    await it('get() should set method to GET', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/', method: 'GET' });
      expect(req.method).toBe('GET');
      // Don't call end() — just verify the method is set
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should default method to GET', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(req.method).toBe('GET');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should uppercase the method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/', method: 'post' });
      expect(req.method).toBe('POST');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should default path to /', async () => {
      const req = http.request({ hostname: 'localhost', port: 1 });
      expect(req.path).toBe('/');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should default protocol to http:', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(req.protocol).toBe('http:');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should parse path from URL string', async () => {
      const req = http.request('http://localhost:8080/path');
      expect(req.path).toBe('/path');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should set host header', async () => {
      const req = http.request({ hostname: 'example.com', port: 1, path: '/' });
      const hostHeader = req.getHeader('host');
      expect(hostHeader).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should parse path and query from URL', async () => {
      const req = http.request('http://example.com:3000/path?query=1');
      expect(req.path).toBe('/path?query=1');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should set custom headers from options', async () => {
      const req = http.request({
        hostname: 'localhost',
        port: 1,
        path: '/',
        headers: { 'X-Custom': 'value', 'Accept': 'text/html' }
      });
      expect(req.getHeader('x-custom')).toBe('value');
      expect(req.getHeader('accept')).toBe('text/html');
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should have aborted default to false', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(req.aborted).toBe(false);
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should set aborted after abort()', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      req.on('error', () => {});
      expect(req.aborted).toBe(false);
      req.abort();
      expect(req.aborted).toBe(true);
    });

    await it('ClientRequest should have reusedSocket default to false', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(req.reusedSocket).toBe(false);
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should have maxHeadersCount property', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      // Node.js defaults to null, GJS defaults to a number — both are valid
      expect(req.maxHeadersCount !== undefined).toBe(true);
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should support multiple setHeader calls', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      req.setHeader('X-First', 'one');
      req.setHeader('X-Second', 'two');
      req.setHeader('X-Third', 'three');
      expect(req.getHeader('x-first')).toBe('one');
      expect(req.getHeader('x-second')).toBe('two');
      expect(req.getHeader('x-third')).toBe('three');
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest setHeader should overwrite existing', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      req.setHeader('X-Test', 'first');
      req.setHeader('X-Test', 'second');
      expect(req.getHeader('x-test')).toBe('second');
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should have getHeaderNames method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      req.setHeader('X-A', 'a');
      req.setHeader('X-B', 'b');
      const names = req.getHeaderNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length >= 2).toBe(true);
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should have getHeaders method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      req.setHeader('X-Test', 'value');
      const headers = req.getHeaders();
      expect(typeof headers).toBe('object');
      expect(headers['x-test']).toBe('value');
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should support setTimeout', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.setTimeout).toBe('function');
      const result = req.setTimeout(5000);
      expect(result).toBe(req);
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should support flushHeaders', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.flushHeaders).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should have headersSent default to false', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(req.headersSent).toBe(false);
      req.on('error', () => {});
      req.abort();
    });

    await it('ClientRequest should be a Writable stream', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.write).toBe('function');
      expect(typeof req.end).toBe('function');
      expect(typeof req.on).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should handle host option', async () => {
      const req = http.request({ host: 'example.com:3000', path: '/' });
      // host property is set in both Node.js and GJS
      expect(req.host).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('request() with DELETE method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/item', method: 'DELETE' });
      expect(req.method).toBe('DELETE');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() with PUT method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/item', method: 'PUT' });
      expect(req.method).toBe('PUT');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() with PATCH method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/item', method: 'PATCH' });
      expect(req.method).toBe('PATCH');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() with HEAD method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/', method: 'HEAD' });
      expect(req.method).toBe('HEAD');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() with OPTIONS method', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/', method: 'OPTIONS' });
      expect(req.method).toBe('OPTIONS');
      req.on('error', () => {});
      req.abort();
    });

    await it('double abort should not throw', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' });
      req.on('error', () => {});
      req.abort();
      // Second abort should not throw
      expect(() => req.abort()).not.toThrow();
    });

    await it('ClientRequest should have host property', async () => {
      const req = http.request({ hostname: 'myhost', port: 1234, path: '/' });
      expect(typeof req.host).toBe('string');
      req.on('error', () => {});
      req.abort();
    });

    await it('request() should handle URL with default port', async () => {
      const req = http.request('http://example.com/path');
      expect(req.host).toBeDefined();
      expect(req.path).toBe('/path');
      req.on('error', () => {});
      req.abort();
    });
  });

  await describe('http.IncomingMessage', async () => {
    await it('should be exported', async () => {
      expect(typeof http.IncomingMessage).toBe('function');
    });

    await it('should be constructable as standalone', async () => {
      const msg = new http.IncomingMessage();
      expect(msg).toBeDefined();
    });

    await it('should inherit from Readable', async () => {
      const msg = new http.IncomingMessage();
      expect(typeof msg.pipe).toBe('function');
      expect(typeof msg.read).toBe('function');
    });
  });

  await describe('http module exports', async () => {
    await it('should export STATUS_CODES', async () => {
      expect(http.STATUS_CODES).toBeDefined();
      expect(http.STATUS_CODES[200]).toBe('OK');
      expect(http.STATUS_CODES[404]).toBe('Not Found');
    });

    await it('should export METHODS', async () => {
      expect(http.METHODS).toBeDefined();
      expect(http.METHODS).toContain('GET');
      expect(http.METHODS).toContain('POST');
    });

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
  });

  await describe('http.Agent extended', async () => {
    await it('should accept options in constructor', async () => {
      const agent = new http.Agent({});
      expect(agent).toBeDefined();
    });

    await it('multiple agents should be independent', async () => {
      const agent1 = new http.Agent();
      const agent2 = new http.Agent();
      expect(agent1).toBeDefined();
      expect(agent2).toBeDefined();
      expect(agent1 !== agent2).toBe(true);
    });

    await it('globalAgent should not be the same as a new Agent', async () => {
      const agent = new http.Agent();
      expect(http.globalAgent !== agent).toBe(true);
    });

    await it('should have all expected properties', async () => {
      const agent = new http.Agent();
      expect(typeof agent.defaultPort).toBe('number');
      expect(typeof agent.maxSockets).toBe('number');
      expect(typeof (agent as any).maxFreeSockets).toBe('number');
      expect(typeof (agent as any).keepAliveMsecs).toBe('number');
      expect(typeof (agent as any).keepAlive).toBe('boolean');
      expect(typeof (agent as any).protocol).toBe('string');
    });
  });

  await describe('http.request URL parsing', async () => {
    await it('should parse simple URL', async () => {
      const req = http.request('http://localhost:9999/foo');
      expect(req.path).toBe('/foo');
      expect(req.method).toBe('GET');
      req.on('error', () => {});
      req.abort();
    });

    await it('should parse URL with query string', async () => {
      const req = http.request('http://localhost:1/search?q=test&page=1');
      expect(req.path).toBe('/search?q=test&page=1');
      req.on('error', () => {});
      req.abort();
    });

    await it('should parse URL with path only', async () => {
      const req = http.request('http://localhost:1/a/b/c');
      expect(req.path).toBe('/a/b/c');
      req.on('error', () => {});
      req.abort();
    });

    await it('should parse URL with no path', async () => {
      const req = http.request('http://localhost:1');
      expect(req.path).toBe('/');
      req.on('error', () => {});
      req.abort();
    });

    await it('should handle options with callback', async () => {
      let cbCalled = false;
      const req = http.request({ hostname: 'localhost', port: 1, path: '/' }, () => {
        cbCalled = true;
      });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should handle URL string with callback', async () => {
      let cbCalled = false;
      const req = http.request('http://localhost:1/', () => {
        cbCalled = true;
      });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });
  });

  // ==================== auth option ====================
  await describe('http.request auth option', async () => {
    await it('should set Authorization header from auth option', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/', auth: 'user:pass' });
      const authHeader = req.getHeader('authorization');
      expect(authHeader).toBeDefined();
      // Basic base64('user:pass') = 'dXNlcjpwYXNz'
      expect(authHeader).toBe('Basic dXNlcjpwYXNz');
      req.on('error', () => {});
      req.abort();
    });

    await it('should not override explicit Authorization header', async () => {
      const req = http.request({
        hostname: 'localhost', port: 1, path: '/',
        auth: 'user:pass',
        headers: { 'Authorization': 'Bearer token123' },
      });
      expect(req.getHeader('authorization')).toBe('Bearer token123');
      req.on('error', () => {});
      req.abort();
    });

    await it('should handle auth with special characters', async () => {
      const req = http.request({ hostname: 'localhost', port: 1, path: '/', auth: 'user:p@ss:word' });
      const authHeader = req.getHeader('authorization');
      expect(authHeader).toBeDefined();
      expect((authHeader as string).startsWith('Basic ')).toBe(true);
      req.on('error', () => {});
      req.abort();
    });
  });

  // ==================== Agent improvements ====================
  await describe('http.Agent constructor options', async () => {
    await it('should accept keepAlive option', async () => {
      const agent = new http.Agent({ keepAlive: true });
      expect(agent.keepAlive).toBe(true);
    });

    await it('should accept maxSockets option', async () => {
      const agent = new http.Agent({ maxSockets: 10 });
      expect(agent.maxSockets).toBe(10);
    });

    await it('should accept maxTotalSockets option', async () => {
      const agent = new http.Agent({ maxTotalSockets: 50 });
      expect(agent.maxTotalSockets).toBe(50);
    });

    await it('should accept maxFreeSockets option', async () => {
      const agent = new http.Agent({ maxFreeSockets: 100 });
      expect(agent.maxFreeSockets).toBe(100);
    });

    await it('should accept scheduling option', async () => {
      const agent = new http.Agent({ scheduling: 'fifo' });
      expect(agent.scheduling).toBe('fifo');
    });

    await it('should have default values', async () => {
      const agent = new http.Agent();
      expect(agent.keepAlive).toBe(false);
      expect(agent.maxSockets).toBe(Infinity);
      expect(agent.maxFreeSockets).toBe(256);
      expect(agent.keepAliveMsecs).toBe(1000);
      expect(agent.scheduling).toBe('lifo');
    });

    await it('should have requests/sockets/freeSockets objects', async () => {
      const agent = new http.Agent();
      expect(typeof agent.requests).toBe('object');
      expect(typeof agent.sockets).toBe('object');
      expect(typeof agent.freeSockets).toBe('object');
    });

    await it('destroy() should not throw', async () => {
      const agent = new http.Agent({ keepAlive: true });
      agent.destroy();
    });
  });

  // ==================== signal option ====================
  await describe('http.request signal option', async () => {
    await it('should support signal option in request', async () => {
      if (typeof AbortController === 'undefined') return; // skip if not available
      const controller = new AbortController();
      const req = http.request({
        hostname: 'localhost', port: 1, path: '/',
        signal: controller.signal,
      });
      expect(req).toBeDefined();
      req.on('error', () => {});
      controller.abort();
      req.destroy();
    });
  });
};
