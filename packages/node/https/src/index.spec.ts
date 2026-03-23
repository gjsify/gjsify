import { describe, it, expect, on } from '@gjsify/unit';
import https, { Agent, globalAgent, request, get } from 'https';

export default async () => {
  await describe('https', async () => {

    // --- Module exports ---
    await describe('exports', async () => {
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

      await it('should have all exports on default export', async () => {
        expect(typeof https.Agent).toBe('function');
        expect(https.globalAgent).toBeDefined();
        expect(typeof https.request).toBe('function');
        expect(typeof https.get).toBe('function');
      });
    });

    // --- Agent ---
    await describe('Agent', async () => {
      await it('should be constructable', async () => {
        const agent = new Agent();
        expect(agent).toBeDefined();
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
        expect(agent.maxSockets).toBe(Infinity);
      });

      await it('should have destroy method', async () => {
        const agent = new Agent();
        expect(typeof agent.destroy).toBe('function');
        expect(() => agent.destroy()).not.toThrow();
      });

      await it('should accept options in constructor', async () => {
        const agent = new Agent({ keepAlive: true });
        expect(agent).toBeDefined();
      });
    });

    // --- globalAgent ---
    await describe('globalAgent', async () => {
      await it('should be an Agent instance', async () => {
        expect(globalAgent).toBeDefined();
        expect(globalAgent.protocol).toBe('https:');
      });

      await it('should have defaultPort 443', async () => {
        expect(globalAgent.defaultPort).toBe(443);
      });
    });

    // --- request function ---
    await describe('request', async () => {
      await it('should return an object with expected methods', async () => {
        const req = request({ hostname: 'localhost', port: 1, path: '/' });
        expect(req).toBeDefined();
        expect(typeof req.end).toBe('function');
        expect(typeof req.write).toBe('function');
        req.on('error', () => {});
        req.abort();
      });

      await it('should accept URL string', async () => {
        const req = request('https://localhost:1/test');
        expect(req).toBeDefined();
        req.on('error', () => {});
        req.abort();
      });

      await it('should accept options with method', async () => {
        const req = request({ hostname: 'localhost', port: 1, path: '/', method: 'POST' });
        expect(req).toBeDefined();
        req.on('error', () => {});
        req.abort();
      });
    });

    // --- get function ---
    await describe('get', async () => {
      await it('should return an object', async () => {
        const req = get({ hostname: 'localhost', port: 1, path: '/' });
        expect(req).toBeDefined();
        req.on('error', () => {});
      });
    });
  });
};
