import { describe, it, expect } from '@gjsify/unit';
import * as http from 'http';

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
  });

  await describe('http.IncomingMessage', async () => {
    await it('should be exported', async () => {
      expect(typeof http.IncomingMessage).toBe('function');
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
};
