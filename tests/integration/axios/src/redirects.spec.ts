// Ported from refs/axios/tests/unit/adapters/http.test.js (redirect tests)
// Original: MIT, axios contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect, on } from '@gjsify/unit';
import axios, { isAxiosError } from 'axios';
import { startHTTPServer, stopHTTPServer } from './test-server.js';

export default async () => {
  await describe('axios: redirects', async () => {
    await it('302 redirect is followed automatically', async () => {
      const srv = await startHTTPServer((req, res) => {
        if (req.url === '/one') {
          res.setHeader('Location', '/two');
          res.statusCode = 302;
          res.end();
          return;
        }
        res.end('test response');
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/one`, {
          maxRedirects: 1,
        });
        expect(response.data).toBe('test response');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('maxRedirects: 0 — redirect is not followed, rejects with status 302', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Location', '/foo');
        res.statusCode = 302;
        res.end();
      });
      try {
        let error: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/one`, { maxRedirects: 0 });
        } catch (e) { error = e; }
        // follow-redirects throws when maxRedirects: 0
        expect(error).toBeDefined();
        if (error.response) {
          expect(error.response.status).toBe(302);
        } else {
          // follow-redirects may also set error.code
          expect(isAxiosError(error)).toBe(true);
        }
      } finally {
        await stopHTTPServer(srv);
      }
    });

    // ERR_FR_TOO_MANY_REDIRECTS is specific to the follow-redirects library used
    // only by the HTTP adapter. The XHR adapter (used on GJS) relies on Soup's
    // built-in redirect handling which does not propagate this error code.
    await on('Node.js', async () => {
      await it('maxRedirects: 3 exceeded — rejects with ERR_FR_TOO_MANY_REDIRECTS', async () => {
        let i = 1;
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Location', `/${i++}`);
          res.statusCode = 302;
          res.end();
        });
        try {
          let error: any;
          try {
            await axios.get(`http://127.0.0.1:${srv.port}/`, { maxRedirects: 3 });
          } catch (e) { error = e; }
          expect(isAxiosError(error)).toBe(true);
          expect(error.code).toBe('ERR_FR_TOO_MANY_REDIRECTS');
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await it('HEAD verb is preserved across 302 redirect', async () => {
      const srv = await startHTTPServer((req, res) => {
        if (req.method !== 'HEAD') { res.statusCode = 400; res.end(); return; }
        if (req.url === '/one') {
          res.setHeader('Location', '/two');
          res.statusCode = 302;
          res.end();
        } else {
          res.end();
        }
      });
      try {
        const response = await axios.head(`http://127.0.0.1:${srv.port}/one`);
        expect(response.status).toBe(200);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    // beforeRedirect is a follow-redirects hook, only available via the HTTP adapter.
    // The XHR adapter on GJS uses Soup's built-in redirect handling without hooks.
    await on('Node.js', async () => {
      await it('beforeRedirect hook is called and can abort the redirect', async () => {
        const srv = await startHTTPServer((req, res) => {
          res.setHeader('Location', '/foo');
          res.statusCode = 302;
          res.end();
        });
        try {
          let error: any;
          try {
            await axios.get(`http://127.0.0.1:${srv.port}/one`, {
              maxRedirects: 3,
              beforeRedirect: (options: any, responseDetails: any) => {
                if (options.path === '/foo') {
                  throw new Error('path not allowed');
                }
              },
            });
          } catch (e) { error = e; }
          expect(error).toBeDefined();
          expect(error.message).toContain('path not allowed');
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });

    await it('301 redirect — final data from redirected location', async () => {
      const srv = await startHTTPServer((req, res) => {
        if (req.url === '/old') {
          res.setHeader('Location', '/new');
          res.statusCode = 301;
          res.end();
          return;
        }
        res.end('new content');
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/old`);
        expect(response.data).toBe('new content');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('chain of 3 redirects succeeds within maxRedirects: 5', async () => {
      const srv = await startHTTPServer((req, res) => {
        const n = parseInt(req.url!.slice(1) || '0', 10);
        if (n < 3) {
          res.setHeader('Location', `/${n + 1}`);
          res.statusCode = 302;
          res.end();
          return;
        }
        res.end('final');
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/0`, { maxRedirects: 5 });
        expect(response.data).toBe('final');
      } finally {
        await stopHTTPServer(srv);
      }
    });
  });
};
