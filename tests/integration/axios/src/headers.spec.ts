// Ported from refs/axios/tests/unit/adapters/http.test.js (header-related tests)
// Original: MIT, axios contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect, on } from '@gjsify/unit';
import axios from 'axios';
import { startHTTPServer, stopHTTPServer } from './test-server.js';

export default async () => {
  await describe('axios: request headers', async () => {
    // HTTP adapter sets User-Agent: axios/VERSION; XHR adapter (used on GJS) does not.
    await on('Node.js', async () => {
      await it('provides a default User-Agent header containing "axios/"', async () => {
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ua: req.headers['user-agent'] }));
        });
        try {
          const response = await axios.get(`http://127.0.0.1:${srv.port}/`);
          expect(typeof response.data.ua).toBe('string');
          expect(response.data.ua.startsWith('axios/')).toBe(true);
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await it('User-Agent header can be overridden', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ua: req.headers['user-agent'] }));
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          headers: { 'User-Agent': 'test-agent/1.0' },
        });
        expect(response.data.ua).toBe('test-agent/1.0');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    // HTTP adapter respects User-Agent: false (omits header); XHR adapter on GJS
    // can't omit User-Agent because our fetch code adds a fallback 'gjsify-fetch' UA.
    await on('Node.js', async () => {
      await it('User-Agent is omitted when explicitly set to false', async () => {
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ua: req.headers['user-agent'] ?? null }));
        });
        try {
          const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
            headers: { 'User-Agent': false as any },
          });
          expect(response.data.ua).toBe(null);
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await it('custom headers are sent to the server', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ xTest: req.headers['x-test'] ?? null }));
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          headers: { 'X-Test': 'hello' },
        });
        expect(response.data.xTest).toBe('hello');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('Content-Length header is computed and sent for string body', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ contentLength: req.headers['content-length'] ?? null }));
      });
      try {
        const response = await axios.post(`http://127.0.0.1:${srv.port}/`, 'hello', {
          headers: { 'Content-Type': 'text/plain' },
        });
        expect(response.data.contentLength).toBe('5');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    // HTTP adapter allows Content-Length override; XHR adapter (browser-like) uses
    // actual body length and ignores user-set Content-Length (forbidden header).
    await on('Node.js', async () => {
      await it('Content-Length header can be overridden', async () => {
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ contentLength: req.headers['content-length'] ?? null }));
        });
        try {
          const response = await axios.post(`http://127.0.0.1:${srv.port}/`, 'hello', {
            headers: { 'Content-Type': 'text/plain', 'Content-Length': '10' },
          });
          expect(response.data.contentLength).toBe('10');
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await it('CRLF in header value is sanitized (newline stripped)', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          xTest: req.headers['x-test'],
          injected: req.headers['injected'] ?? null,
        }));
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          headers: { 'x-test': '\tok\r\nInjected: yes' },
        });
        // axios strips the CRLF; the injected header must not appear
        expect(response.data.injected).toBe(null);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('response headers are accessible case-insensitively', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('X-Response-Id', '42');
        res.end();
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`);
        expect(response.headers['x-response-id']).toBe('42');
      } finally {
        await stopHTTPServer(srv);
      }
    });
  });
};
