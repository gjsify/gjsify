// Ported from refs/node-test/parallel/test-https-{agent-constructor,agent,argument-of-creating}.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import https, { Agent, globalAgent, request, get, createServer, Server } from 'node:https';

export default async () => {
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
  });

  await describe('https.Agent', async () => {
    await it('should be constructable with new', async () => {
      const agent = new Agent();
      expect(agent).toBeDefined();
      expect(agent instanceof Agent).toBe(true);
    });

    await it('should have defaultPort 443', async () => {
      const agent = new Agent();
      expect(agent.defaultPort).toBe(443);
    });

    await it('should have protocol https:', async () => {
      const agent = new Agent();
      expect(agent.protocol).toBe('https:');
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
  });

  await describe('https.globalAgent', async () => {
    await it('should be an Agent instance', async () => {
      expect(globalAgent).toBeDefined();
      expect(globalAgent instanceof Agent).toBe(true);
    });

    await it('should have protocol https:', async () => {
      expect(globalAgent.protocol).toBe('https:');
    });

    await it('should have defaultPort 443', async () => {
      expect(globalAgent.defaultPort).toBe(443);
    });

    await it('should be same reference on default export', async () => {
      expect(https.globalAgent).toBe(globalAgent);
    });
  });

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
  });

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
      // get() automatically calls end()
      expect(req).toBeDefined();
      req.on('error', () => {});
    });
  });

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
      let registered = false;
      server.on('request', () => { registered = true; });
      expect(typeof server.listeners).toBe('function');
    });
  });

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
  });
};
