// Extended HTTP tests — header validation, STATUS_CODES depth, Agent details,
// IncomingMessage/ServerResponse properties
// Ported from refs/node-test/parallel/test-http-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as http from 'node:http';

export default async () => {

  // ===================== STATUS_CODES comprehensive =====================
  await describe('http.STATUS_CODES comprehensive', async () => {
    await it('should be a non-empty object', async () => {
      expect(typeof http.STATUS_CODES).toBe('object');
      expect(Object.keys(http.STATUS_CODES).length).toBeGreaterThan(0);
    });

    // 1xx Informational
    await it('100 should be Continue', async () => {
      expect(http.STATUS_CODES[100]).toBe('Continue');
    });

    await it('101 should be Switching Protocols', async () => {
      expect(http.STATUS_CODES[101]).toBe('Switching Protocols');
    });

    await it('102 should be Processing', async () => {
      expect(http.STATUS_CODES[102]).toBe('Processing');
    });

    await it('103 should be Early Hints', async () => {
      expect(http.STATUS_CODES[103]).toBe('Early Hints');
    });

    // 2xx Success
    await it('200 should be OK', async () => {
      expect(http.STATUS_CODES[200]).toBe('OK');
    });

    await it('201 should be Created', async () => {
      expect(http.STATUS_CODES[201]).toBe('Created');
    });

    await it('202 should be Accepted', async () => {
      expect(http.STATUS_CODES[202]).toBe('Accepted');
    });

    await it('204 should be No Content', async () => {
      expect(http.STATUS_CODES[204]).toBe('No Content');
    });

    await it('206 should be Partial Content', async () => {
      expect(http.STATUS_CODES[206]).toBe('Partial Content');
    });

    await it('207 should be Multi-Status', async () => {
      expect(http.STATUS_CODES[207]).toBe('Multi-Status');
    });

    // 3xx Redirection
    await it('301 should be Moved Permanently', async () => {
      expect(http.STATUS_CODES[301]).toBe('Moved Permanently');
    });

    await it('302 should be Found', async () => {
      expect(http.STATUS_CODES[302]).toBe('Found');
    });

    await it('303 should be See Other', async () => {
      expect(http.STATUS_CODES[303]).toBe('See Other');
    });

    await it('304 should be Not Modified', async () => {
      expect(http.STATUS_CODES[304]).toBe('Not Modified');
    });

    await it('307 should be Temporary Redirect', async () => {
      expect(http.STATUS_CODES[307]).toBe('Temporary Redirect');
    });

    await it('308 should be Permanent Redirect', async () => {
      expect(http.STATUS_CODES[308]).toBe('Permanent Redirect');
    });

    // 4xx Client Errors
    await it('400 should be Bad Request', async () => {
      expect(http.STATUS_CODES[400]).toBe('Bad Request');
    });

    await it('401 should be Unauthorized', async () => {
      expect(http.STATUS_CODES[401]).toBe('Unauthorized');
    });

    await it('403 should be Forbidden', async () => {
      expect(http.STATUS_CODES[403]).toBe('Forbidden');
    });

    await it('404 should be Not Found', async () => {
      expect(http.STATUS_CODES[404]).toBe('Not Found');
    });

    await it('405 should be Method Not Allowed', async () => {
      expect(http.STATUS_CODES[405]).toBe('Method Not Allowed');
    });

    await it('408 should be Request Timeout', async () => {
      expect(http.STATUS_CODES[408]).toBe('Request Timeout');
    });

    await it('409 should be Conflict', async () => {
      expect(http.STATUS_CODES[409]).toBe('Conflict');
    });

    await it('410 should be Gone', async () => {
      expect(http.STATUS_CODES[410]).toBe('Gone');
    });

    await it('413 should be Payload Too Large', async () => {
      expect(http.STATUS_CODES[413]).toBe('Payload Too Large');
    });

    await it('415 should be Unsupported Media Type', async () => {
      expect(http.STATUS_CODES[415]).toBe('Unsupported Media Type');
    });

    await it('418 should be I\'m a Teapot', async () => {
      expect(http.STATUS_CODES[418]).toBe("I'm a Teapot");
    });

    await it('422 should be Unprocessable Entity', async () => {
      expect(http.STATUS_CODES[422]).toBe('Unprocessable Entity');
    });

    await it('429 should be Too Many Requests', async () => {
      expect(http.STATUS_CODES[429]).toBe('Too Many Requests');
    });

    // 5xx Server Errors
    await it('500 should be Internal Server Error', async () => {
      expect(http.STATUS_CODES[500]).toBe('Internal Server Error');
    });

    await it('501 should be Not Implemented', async () => {
      expect(http.STATUS_CODES[501]).toBe('Not Implemented');
    });

    await it('502 should be Bad Gateway', async () => {
      expect(http.STATUS_CODES[502]).toBe('Bad Gateway');
    });

    await it('503 should be Service Unavailable', async () => {
      expect(http.STATUS_CODES[503]).toBe('Service Unavailable');
    });

    await it('504 should be Gateway Timeout', async () => {
      expect(http.STATUS_CODES[504]).toBe('Gateway Timeout');
    });

    await it('all values should be strings', async () => {
      for (const [code, text] of Object.entries(http.STATUS_CODES)) {
        expect(typeof text).toBe('string');
        expect((text as string).length).toBeGreaterThan(0);
      }
    });

    await it('all keys should be numeric strings', async () => {
      for (const code of Object.keys(http.STATUS_CODES)) {
        expect(Number.isInteger(Number(code))).toBe(true);
      }
    });

    await it('should have at least 60 status codes', async () => {
      expect(Object.keys(http.STATUS_CODES).length).toBeGreaterThan(59);
    });

    await it('unknown status code should be undefined', async () => {
      expect((http.STATUS_CODES as any)[999]).toBeUndefined();
    });
  });

  // ===================== METHODS comprehensive =====================
  await describe('http.METHODS comprehensive', async () => {
    await it('should be an array', async () => {
      expect(Array.isArray(http.METHODS)).toBe(true);
    });

    await it('should contain GET', async () => {
      expect(http.METHODS).toContain('GET');
    });

    await it('should contain POST', async () => {
      expect(http.METHODS).toContain('POST');
    });

    await it('should contain PUT', async () => {
      expect(http.METHODS).toContain('PUT');
    });

    await it('should contain DELETE', async () => {
      expect(http.METHODS).toContain('DELETE');
    });

    await it('should contain PATCH', async () => {
      expect(http.METHODS).toContain('PATCH');
    });

    await it('should contain HEAD', async () => {
      expect(http.METHODS).toContain('HEAD');
    });

    await it('should contain OPTIONS', async () => {
      expect(http.METHODS).toContain('OPTIONS');
    });

    await it('should contain CONNECT', async () => {
      expect(http.METHODS).toContain('CONNECT');
    });

    await it('should contain TRACE', async () => {
      expect(http.METHODS).toContain('TRACE');
    });

    await it('should be sorted alphabetically', async () => {
      const sorted = [...http.METHODS].sort();
      for (let i = 0; i < http.METHODS.length; i++) {
        expect(http.METHODS[i]).toBe(sorted[i]);
      }
    });

    await it('should have no duplicates', async () => {
      const unique = new Set(http.METHODS);
      expect(unique.size).toBe(http.METHODS.length);
    });

    await it('all methods should be uppercase strings', async () => {
      for (const m of http.METHODS) {
        expect(typeof m).toBe('string');
        expect(m).toBe(m.toUpperCase());
      }
    });

    await it('should have at least 9 standard methods', async () => {
      expect(http.METHODS.length).toBeGreaterThan(8);
    });
  });

  // ===================== validateHeaderName =====================
  await describe('http.validateHeaderName extended', async () => {
    await it('should accept standard header names', async () => {
      const valid = [
        'Content-Type', 'Accept', 'Authorization', 'Cache-Control',
        'X-Custom-Header', 'x-lowercase', 'UPPERCASE',
      ];
      for (const name of valid) {
        expect(() => http.validateHeaderName(name)).not.toThrow();
      }
    });

    await it('should accept headers with digits', async () => {
      expect(() => http.validateHeaderName('X-Request-Id-123')).not.toThrow();
    });

    await it('should accept headers with special token chars', async () => {
      // RFC 7230 token chars: !#$%&'*+-.^_`|~
      expect(() => http.validateHeaderName('X-Header!')).not.toThrow();
      expect(() => http.validateHeaderName('X-Header#')).not.toThrow();
      expect(() => http.validateHeaderName('X-Header^')).not.toThrow();
      expect(() => http.validateHeaderName('X-Header~')).not.toThrow();
    });

    await it('should reject empty string', async () => {
      expect(() => http.validateHeaderName('')).toThrow();
    });

    await it('should reject header with space', async () => {
      expect(() => http.validateHeaderName('Invalid Header')).toThrow();
    });

    await it('should reject header with colon', async () => {
      expect(() => http.validateHeaderName('Invalid:Header')).toThrow();
    });

    await it('should reject non-string values', async () => {
      expect(() => http.validateHeaderName(123 as any)).toThrow();
      expect(() => http.validateHeaderName(null as any)).toThrow();
      expect(() => http.validateHeaderName(undefined as any)).toThrow();
    });

    await it('should reject header with control characters', async () => {
      expect(() => http.validateHeaderName('X-Header\x00')).toThrow();
      expect(() => http.validateHeaderName('X-Header\x0D')).toThrow();
      expect(() => http.validateHeaderName('X-Header\x0A')).toThrow();
    });
  });

  // ===================== validateHeaderValue =====================
  await describe('http.validateHeaderValue extended', async () => {
    await it('should accept normal string values', async () => {
      expect(() => http.validateHeaderValue('Content-Type', 'text/html')).not.toThrow();
      expect(() => http.validateHeaderValue('Accept', 'application/json')).not.toThrow();
    });

    await it('should accept numeric values', async () => {
      expect(() => http.validateHeaderValue('Content-Length', '1234')).not.toThrow();
    });

    await it('should accept empty string value', async () => {
      expect(() => http.validateHeaderValue('X-Empty', '')).not.toThrow();
    });

    await it('should accept values with tabs', async () => {
      expect(() => http.validateHeaderValue('X-Tab', 'val\t')).not.toThrow();
    });

    await it('should reject undefined value', async () => {
      expect(() => http.validateHeaderValue('X-Header', undefined as any)).toThrow();
    });

    await it('should reject value with NUL character', async () => {
      expect(() => http.validateHeaderValue('X-Header', 'val\x00ue')).toThrow();
    });

    await it('should reject value with bare CR', async () => {
      expect(() => http.validateHeaderValue('X-Header', 'val\rue')).toThrow();
    });

    await it('should reject value with bare LF', async () => {
      expect(() => http.validateHeaderValue('X-Header', 'val\nue')).toThrow();
    });
  });

  // ===================== maxHeaderSize =====================
  await describe('http.maxHeaderSize', async () => {
    await it('should be a number', async () => {
      expect(typeof http.maxHeaderSize).toBe('number');
    });

    await it('should be positive', async () => {
      expect(http.maxHeaderSize).toBeGreaterThan(0);
    });

    await it('should be at least 8KB', async () => {
      expect(http.maxHeaderSize).toBeGreaterThan(8191);
    });
  });

  // ===================== Agent extended =====================
  await describe('http.Agent extended', async () => {
    await it('should be constructable', async () => {
      const agent = new http.Agent();
      expect(agent).toBeDefined();
    });

    await it('should accept keepAlive option', async () => {
      const agent = new http.Agent({ keepAlive: true });
      expect(agent).toBeDefined();
    });

    await it('should accept maxSockets option', async () => {
      const agent = new http.Agent({ maxSockets: 5 });
      expect(agent).toBeDefined();
    });

    await it('should accept timeout option', async () => {
      const agent = new http.Agent({ timeout: 10000 });
      expect(agent).toBeDefined();
    });

    await it('should accept maxFreeSockets option', async () => {
      const agent = new http.Agent({ maxFreeSockets: 128 });
      expect(agent).toBeDefined();
    });

    await it('should accept scheduling option', async () => {
      const agent = new http.Agent({ scheduling: 'fifo' });
      expect(agent).toBeDefined();
    });

    await it('should have destroy method', async () => {
      const agent = new http.Agent();
      expect(typeof agent.destroy).toBe('function');
    });

    await it('destroy should not throw', async () => {
      const agent = new http.Agent();
      expect(() => agent.destroy()).not.toThrow();
    });

    await it('maxSockets should default to Infinity', async () => {
      const agent = new http.Agent();
      expect(agent.maxSockets).toBe(Infinity);
    });

    await it('two agents should be independent', async () => {
      const a1 = new http.Agent();
      const a2 = new http.Agent();
      expect(a1).not.toBe(a2);
    });

    await it('should have getName method', async () => {
      const agent = new http.Agent();
      expect(typeof agent.getName).toBe('function');
    });
  });

  // ===================== globalAgent =====================
  await describe('http.globalAgent extended', async () => {
    await it('should be defined', async () => {
      expect(http.globalAgent).toBeDefined();
    });

    await it('should be an Agent instance', async () => {
      expect(http.globalAgent instanceof http.Agent).toBe(true);
    });

    await it('should have maxSockets as Infinity', async () => {
      expect(http.globalAgent.maxSockets).toBe(Infinity);
    });

    await it('should be singleton', async () => {
      expect(http.globalAgent).toBe(http.globalAgent);
    });
  });

  // ===================== OutgoingMessage properties =====================
  await describe('http.OutgoingMessage extended', async () => {
    await it('should export OutgoingMessage class', async () => {
      expect(typeof http.OutgoingMessage).toBe('function');
    });

    await it('should be constructable', async () => {
      const msg = new http.OutgoingMessage();
      expect(msg).toBeDefined();
    });

    await it('should have setHeader method', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.setHeader).toBe('function');
    });

    await it('should have getHeader method', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.getHeader).toBe('function');
    });

    await it('should have removeHeader method', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.removeHeader).toBe('function');
    });

    await it('should have hasHeader method', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.hasHeader).toBe('function');
    });

    await it('should have getHeaderNames method', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.getHeaderNames).toBe('function');
    });

    await it('should have getHeaders method', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.getHeaders).toBe('function');
    });

    await it('setHeader/getHeader roundtrip', async () => {
      const msg = new http.OutgoingMessage();
      msg.setHeader('Content-Type', 'text/plain');
      expect(msg.getHeader('Content-Type')).toBe('text/plain');
    });

    await it('headers should be case-insensitive', async () => {
      const msg = new http.OutgoingMessage();
      msg.setHeader('Content-Type', 'text/html');
      expect(msg.getHeader('content-type')).toBe('text/html');
      expect(msg.getHeader('CONTENT-TYPE')).toBe('text/html');
    });

    await it('hasHeader should return boolean', async () => {
      const msg = new http.OutgoingMessage();
      expect(msg.hasHeader('X-Nope')).toBe(false);
      msg.setHeader('X-Yep', 'yes');
      expect(msg.hasHeader('X-Yep')).toBe(true);
    });

    await it('removeHeader should remove the header', async () => {
      const msg = new http.OutgoingMessage();
      msg.setHeader('X-Remove', 'val');
      expect(msg.hasHeader('X-Remove')).toBe(true);
      msg.removeHeader('X-Remove');
      expect(msg.hasHeader('X-Remove')).toBe(false);
    });

    await it('getHeaderNames should return array of names', async () => {
      const msg = new http.OutgoingMessage();
      msg.setHeader('Content-Type', 'text/html');
      msg.setHeader('X-Custom', 'foo');
      const names = msg.getHeaderNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBe(2);
    });

    await it('getHeaders should return headers object', async () => {
      const msg = new http.OutgoingMessage();
      msg.setHeader('Content-Type', 'text/html');
      msg.setHeader('X-Num', '42');
      const headers = msg.getHeaders();
      expect(typeof headers).toBe('object');
      expect(headers['content-type']).toBe('text/html');
    });

    await it('should have headersSent property', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.headersSent).toBe('boolean');
      expect(msg.headersSent).toBe(false);
    });

    await it('should have writableEnded property', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.writableEnded).toBe('boolean');
    });

    await it('should have writableFinished property', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.writableFinished).toBe('boolean');
    });

    await it('setHeader should overwrite existing header', async () => {
      const msg = new http.OutgoingMessage();
      msg.setHeader('X-Test', 'first');
      msg.setHeader('X-Test', 'second');
      expect(msg.getHeader('X-Test')).toBe('second');
    });

    await it('setHeader should accept array values', async () => {
      const msg = new http.OutgoingMessage();
      msg.setHeader('Set-Cookie', ['a=1', 'b=2']);
      const val = msg.getHeader('Set-Cookie');
      expect(Array.isArray(val)).toBe(true);
    });

    await it('should have appendHeader method', async () => {
      const msg = new http.OutgoingMessage();
      expect(typeof msg.appendHeader).toBe('function');
    });
  });

  // ===================== IncomingMessage properties =====================
  await describe('http.IncomingMessage', async () => {
    await it('should export IncomingMessage class', async () => {
      expect(typeof http.IncomingMessage).toBe('function');
    });

    await it('should export ServerResponse class', async () => {
      expect(typeof http.ServerResponse).toBe('function');
    });

    await it('should export ClientRequest class', async () => {
      expect(typeof http.ClientRequest).toBe('function');
    });
  });

  // ===================== createServer =====================
  await describe('http.createServer extended', async () => {
    await it('should be a function', async () => {
      expect(typeof http.createServer).toBe('function');
    });

    await it('should return a Server', async () => {
      const server = http.createServer();
      expect(server).toBeDefined();
      expect(typeof server.listen).toBe('function');
      expect(typeof server.close).toBe('function');
    });

    await it('should accept options object', async () => {
      const server = http.createServer({});
      expect(server).toBeDefined();
    });

    await it('should accept requestListener', async () => {
      const server = http.createServer((_req, _res) => {});
      expect(server).toBeDefined();
    });

    await it('should accept options and requestListener', async () => {
      const server = http.createServer({}, (_req, _res) => {});
      expect(server).toBeDefined();
    });

    await it('server should have setTimeout method', async () => {
      const server = http.createServer();
      expect(typeof server.setTimeout).toBe('function');
    });

    await it('server should have address method', async () => {
      const server = http.createServer();
      expect(typeof server.address).toBe('function');
    });

    await it('server should have maxConnections property', async () => {
      const server = http.createServer();
      expect(typeof server.maxConnections === 'number' || server.maxConnections === undefined).toBe(true);
    });

    await it('server should have listening property', async () => {
      const server = http.createServer();
      expect(typeof server.listening).toBe('boolean');
      expect(server.listening).toBe(false);
    });

    await it('server should be an EventEmitter', async () => {
      const server = http.createServer();
      expect(typeof server.on).toBe('function');
      expect(typeof server.emit).toBe('function');
      expect(typeof server.once).toBe('function');
      expect(typeof server.removeListener).toBe('function');
    });
  });
};
