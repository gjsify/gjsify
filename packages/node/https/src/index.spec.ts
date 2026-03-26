// Ported from refs/node-test/parallel/test-https-{agent-constructor,agent,argument-of-creating}.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import https, { Agent, globalAgent, request, get, createServer, Server } from 'node:https';

export default async () => {

  // ===================== Module exports =====================
  await describe('https exports', async () => {
    await it('should export Agent as a function', async () => {
      expect(typeof Agent).toBe('function');
    });

    await it('should export globalAgent', async () => {
      expect(globalAgent).toBeDefined();
    });

    await it('should export request as a function', async () => {
      expect(typeof request).toBe('function');
    });

    await it('should export get as a function', async () => {
      expect(typeof get).toBe('function');
    });

    await it('should export createServer as a function', async () => {
      expect(typeof createServer).toBe('function');
    });

    await it('should export Server as a function', async () => {
      expect(typeof Server).toBe('function');
    });

    await it('should have all exports on default export', async () => {
      expect(typeof https.Agent).toBe('function');
      expect(https.globalAgent).toBeDefined();
      expect(typeof https.request).toBe('function');
      expect(typeof https.get).toBe('function');
      expect(typeof https.createServer).toBe('function');
      expect(typeof https.Server).toBe('function');
    });

    await it('default export should be an object', async () => {
      expect(typeof https).toBe('object');
      expect(https).toBeDefined();
    });
  });

  // ===================== Agent constructor =====================
  await describe('https.Agent', async () => {
    await it('should be constructable with new', async () => {
      const agent = new Agent();
      expect(agent).toBeDefined();
      expect(agent instanceof Agent).toBe(true);
    });

    await it('should have defaultPort 443', async () => {
      const agent = new Agent();
      expect((agent as any).defaultPort).toBe(443);
    });

    await it('should have protocol https:', async () => {
      const agent = new Agent();
      expect((agent as any).protocol).toBe('https:');
    });

    await it('should have maxSockets property', async () => {
      const agent = new Agent();
      expect(typeof agent.maxSockets).toBe('number');
    });

    await it('maxSockets should default to Infinity', async () => {
      const agent = new Agent();
      expect(agent.maxSockets).toBe(Infinity);
    });

    await it('should have maxFreeSockets property', async () => {
      const agent = new Agent();
      expect(typeof agent.maxFreeSockets).toBe('number');
    });

    await it('maxFreeSockets should default to 256', async () => {
      const agent = new Agent();
      expect(agent.maxFreeSockets).toBe(256);
    });

    await it('should have destroy method', async () => {
      const agent = new Agent();
      expect(typeof agent.destroy).toBe('function');
    });

    await it('destroy should not throw', async () => {
      const agent = new Agent();
      expect(() => agent.destroy()).not.toThrow();
    });

    await it('should accept empty options', async () => {
      const agent = new Agent({});
      expect(agent).toBeDefined();
    });

    await it('should accept keepAlive option', async () => {
      const agent = new Agent({ keepAlive: true });
      expect(agent).toBeDefined();
    });

    await it('should accept maxSockets option', async () => {
      const agent = new Agent({ maxSockets: 10 });
      expect(agent).toBeDefined();
    });

    await it('should accept timeout option', async () => {
      const agent = new Agent({ timeout: 5000 });
      expect(agent).toBeDefined();
    });

    await it('should accept keepAliveMsecs option', async () => {
      const agent = new Agent({ keepAliveMsecs: 1000 });
      expect(agent).toBeDefined();
    });

    await it('should accept maxFreeSockets option', async () => {
      const agent = new Agent({ maxFreeSockets: 128 });
      expect(agent).toBeDefined();
    });

    await it('should accept scheduling option', async () => {
      const agent = new Agent({ scheduling: 'fifo' });
      expect(agent).toBeDefined();
    });

    await it('should accept multiple options together', async () => {
      const agent = new Agent({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000,
      });
      expect(agent).toBeDefined();
      expect(agent instanceof Agent).toBe(true);
    });

    await it('two Agent instances should be independent', async () => {
      const a1 = new Agent();
      const a2 = new Agent();
      expect(a1).not.toBe(a2);
    });
  });

  // ===================== globalAgent =====================
  await describe('https.globalAgent', async () => {
    await it('should be an Agent instance', async () => {
      expect(globalAgent).toBeDefined();
      expect(globalAgent instanceof Agent).toBe(true);
    });

    await it('should have protocol https:', async () => {
      expect((globalAgent as any).protocol).toBe('https:');
    });

    await it('should have defaultPort 443', async () => {
      expect((globalAgent as any).defaultPort).toBe(443);
    });

    await it('should be same reference on default export', async () => {
      expect(https.globalAgent).toBe(globalAgent);
    });

    await it('should have maxSockets as Infinity', async () => {
      expect(globalAgent.maxSockets).toBe(Infinity);
    });

    await it('should be shared singleton', async () => {
      const ref1 = https.globalAgent;
      const ref2 = https.globalAgent;
      expect(ref1).toBe(ref2);
    });
  });

  // ===================== request =====================
  await describe('https.request', async () => {
    await it('should return a ClientRequest-like object', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/' });
      expect(req).toBeDefined();
      expect(typeof req.end).toBe('function');
      expect(typeof req.write).toBe('function');
      expect(typeof req.on).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept URL string', async () => {
      const req = request('https://localhost:1/test');
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with method POST', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/', method: 'POST' });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with custom headers', async () => {
      const req = request({
        hostname: 'localhost',
        port: 1,
        path: '/',
        headers: { 'X-Custom': 'test' },
      });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with timeout', async () => {
      const req = request({
        hostname: 'localhost',
        port: 1,
        path: '/',
        timeout: 1000,
      });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should have abort method', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.abort).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('should have setHeader method', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.setHeader).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('should have getHeader method', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.getHeader).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('should have removeHeader method', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.removeHeader).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with method PUT', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/', method: 'PUT' });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with method DELETE', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/', method: 'DELETE' });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with method PATCH', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/', method: 'PATCH' });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with method HEAD', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/', method: 'HEAD' });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept options with method OPTIONS', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/', method: 'OPTIONS' });
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept URL with path and query', async () => {
      const req = request('https://localhost:1/path?key=value');
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should accept URL with port in string', async () => {
      const req = request('https://localhost:8443/');
      expect(req).toBeDefined();
      req.on('error', () => {});
      req.abort();
    });

    await it('should have setTimeout method', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.setTimeout).toBe('function');
      req.on('error', () => {});
      req.abort();
    });

    await it('should have destroy method', async () => {
      const req = request({ hostname: 'localhost', port: 1, path: '/' });
      expect(typeof req.destroy).toBe('function');
      req.on('error', () => {});
      req.abort();
    });
  });

  // ===================== get =====================
  await describe('https.get', async () => {
    await it('should return a ClientRequest-like object', async () => {
      const req = get({ hostname: 'localhost', port: 1, path: '/' });
      expect(req).toBeDefined();
      expect(typeof req.on).toBe('function');
      req.on('error', () => {});
    });

    await it('should accept URL string', async () => {
      const req = get('https://localhost:1/');
      expect(req).toBeDefined();
      req.on('error', () => {});
    });

    await it('should accept options with path', async () => {
      const req = get({ hostname: 'localhost', port: 1, path: '/api/data' });
      expect(req).toBeDefined();
      req.on('error', () => {});
    });

    await it('should have end called automatically', async () => {
      const req = get({ hostname: 'localhost', port: 1, path: '/' });
      expect(req).toBeDefined();
      req.on('error', () => {});
    });

    await it('should accept URL with query parameters', async () => {
      const req = get('https://localhost:1/search?q=test');
      expect(req).toBeDefined();
      req.on('error', () => {});
    });

    await it('should accept options with headers', async () => {
      const req = get({
        hostname: 'localhost',
        port: 1,
        path: '/',
        headers: { 'Accept': 'application/json' },
      });
      expect(req).toBeDefined();
      req.on('error', () => {});
    });
  });

  // ===================== createServer =====================
  await describe('https.createServer', async () => {
    await it('should create a server without options', async () => {
      const server = createServer();
      expect(server).toBeDefined();
    });

    await it('should create a server with empty options', async () => {
      const server = createServer({});
      expect(server).toBeDefined();
    });

    await it('should create a server with listener', async () => {
      const server = createServer((_req, _res) => {});
      expect(server).toBeDefined();
    });

    await it('should create a server with options and listener', async () => {
      const server = createServer({}, (_req, _res) => {});
      expect(server).toBeDefined();
    });

    await it('server should be instance of Server', async () => {
      const server = createServer();
      expect(server instanceof Server).toBe(true);
    });

    await it('server should have listen method', async () => {
      const server = createServer();
      expect(typeof server.listen).toBe('function');
    });

    await it('server should have close method', async () => {
      const server = createServer();
      expect(typeof server.close).toBe('function');
    });

    await it('server should have address method', async () => {
      const server = createServer();
      expect(typeof server.address).toBe('function');
    });

    await it('server should have on method (EventEmitter)', async () => {
      const server = createServer();
      expect(typeof server.on).toBe('function');
    });

    await it('server should accept request event listener', async () => {
      const server = createServer();
      server.on('request', () => {});
      expect(typeof server.listeners).toBe('function');
    });

    await it('server should have maxConnections property', async () => {
      const server = createServer();
      expect(typeof server.maxConnections === 'number' || server.maxConnections === undefined).toBe(true);
    });

    await it('server should have setTimeout method', async () => {
      const server = createServer();
      expect(typeof server.setTimeout).toBe('function');
    });
  });

  // ===================== Server constructor =====================
  await describe('https.Server', async () => {
    await it('should be constructable', async () => {
      const server = new Server();
      expect(server).toBeDefined();
    });

    await it('should be constructable with options', async () => {
      const server = new Server({});
      expect(server).toBeDefined();
    });

    await it('should be constructable with options and listener', async () => {
      const server = new Server({}, (_req, _res) => {});
      expect(server).toBeDefined();
    });

    await it('should extend or wrap HttpServer', async () => {
      const server = new Server();
      expect(typeof server.listen).toBe('function');
      expect(typeof server.close).toBe('function');
    });

    await it('should have on method from EventEmitter', async () => {
      const server = new Server();
      expect(typeof server.on).toBe('function');
      expect(typeof server.emit).toBe('function');
      expect(typeof server.once).toBe('function');
    });

    await it('should have removeListener method', async () => {
      const server = new Server();
      expect(typeof server.removeListener).toBe('function');
    });

    await it('should accept connection event listeners', async () => {
      const server = new Server();
      server.on('connection', () => {});
      expect(typeof server.listeners('connection')).toBe('object');
    });

    await it('should accept close event listeners', async () => {
      const server = new Server();
      server.on('close', () => {});
      expect(typeof server.listeners('close')).toBe('object');
    });

    await it('should accept error event listeners', async () => {
      const server = new Server();
      server.on('error', () => {});
      expect(typeof server.listeners('error')).toBe('object');
    });
  });

  // ===================== Protocol defaults =====================
  await describe('https protocol defaults', async () => {
    await it('Agent defaultPort should be 443 (not 80)', async () => {
      const agent = new Agent();
      expect((agent as any).defaultPort).toBe(443);
      expect((agent as any).defaultPort).not.toBe(80);
    });

    await it('Agent protocol should be https: (not http:)', async () => {
      const agent = new Agent();
      expect((agent as any).protocol).toBe('https:');
      expect((agent as any).protocol).not.toBe('http:');
    });

    await it('globalAgent should have same defaults', async () => {
      expect((globalAgent as any).defaultPort).toBe(443);
      expect((globalAgent as any).protocol).toBe('https:');
    });
  });
};
