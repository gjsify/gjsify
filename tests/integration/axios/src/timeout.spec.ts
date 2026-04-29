// Ported from refs/axios/tests/unit/adapters/http.test.js (timeout tests)
// Original: MIT, axios contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect, on } from '@gjsify/unit';
import axios, { isAxiosError } from 'axios';
import { startHTTPServer, stopHTTPServer } from './test-server.js';

export default async () => {
  await describe('axios: timeout', async () => {
    await it('timeout: 250 rejects before a 1000ms server responds', async () => {
      const srv = await startHTTPServer((req, res) => {
        setTimeout(() => res.end(), 1000);
      });
      try {
        let error: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/`, { timeout: 250 });
        } catch (e) { error = e; }
        expect(isAxiosError(error)).toBe(true);
        expect(error.code).toBe('ECONNABORTED');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('timeout error message contains the timeout value', async () => {
      const srv = await startHTTPServer((req, res) => {
        setTimeout(() => res.end(), 1000);
      });
      try {
        let error: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/`, { timeout: 250 });
        } catch (e) { error = e; }
        expect(error.message).toBe('timeout of 250ms exceeded');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('timeout as string is parsed and respected', async () => {
      const srv = await startHTTPServer((req, res) => {
        setTimeout(() => res.end(), 1000);
      });
      try {
        let error: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/`, { timeout: '250' as any });
        } catch (e) { error = e; }
        expect(error.code).toBe('ECONNABORTED');
        expect(error.message).toBe('timeout of 250ms exceeded');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('timeoutErrorMessage overrides the default message', async () => {
      const srv = await startHTTPServer((req, res) => {
        setTimeout(() => res.end(), 1000);
      });
      try {
        let error: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/`, {
            timeout: 250,
            timeoutErrorMessage: 'oops, timeout',
          });
        } catch (e) { error = e; }
        expect(error.code).toBe('ECONNABORTED');
        expect(error.message).toBe('oops, timeout');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('timeout: 0 means no timeout — slow server still responds', async () => {
      const srv = await startHTTPServer((req, res) => {
        setTimeout(() => res.end('ok'), 300);
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          timeout: 0,
          responseType: 'text',
        });
        expect(response.status).toBe(200);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    // HTTP adapter validates timeout type and throws ERR_BAD_OPTION_VALUE;
    // XHR adapter on GJS passes timeout to XHR.timeout (object→NaN, treated as no timeout).
    await on('Node.js', async () => {
      await it('invalid timeout option throws ERR_BAD_OPTION_VALUE', async () => {
        const srv = await startHTTPServer((req, res) => {
          setTimeout(() => res.end(), 1000);
        });
        try {
          let error: any;
          try {
            await axios.get(`http://127.0.0.1:${srv.port}/`, {
              timeout: { strangeTimeout: 250 } as any,
            });
          } catch (e) { error = e; }
          expect(isAxiosError(error)).toBe(true);
          expect(error.code).toBe('ERR_BAD_OPTION_VALUE');
        } finally {
          await stopHTTPServer(srv);
        }
      });
    });
  });
};
