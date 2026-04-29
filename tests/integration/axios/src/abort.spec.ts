// Ported from refs/axios/tests/unit/adapters/http.test.js (cancel/abort tests)
// Original: MIT, axios contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import axios from 'axios';
import { startHTTPServer, stopHTTPServer } from './test-server.js';

export default async () => {
  await describe('axios: request aborting', async () => {
    await it('CancelToken cancels in-flight request', async () => {
      const source = axios.CancelToken.source();
      const srv = await startHTTPServer((req, res) => {
        // Cancel as soon as the server receives the request
        source.cancel('Operation has been canceled.');
      });
      try {
        let thrown: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/`, { cancelToken: source.token });
        } catch (e) { thrown = e; }
        expect(thrown).toBeDefined();
        expect(axios.isCancel(thrown)).toBe(true);
        expect(thrown.message).toBe('Operation has been canceled.');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('CancelToken.source().cancel() before request — rejects immediately', async () => {
      const source = axios.CancelToken.source();
      source.cancel('pre-cancelled');
      const srv = await startHTTPServer((req, res) => { res.end(); });
      try {
        let thrown: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/`, { cancelToken: source.token });
        } catch (e) { thrown = e; }
        expect(axios.isCancel(thrown)).toBe(true);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('AbortController.abort() cancels the request', async () => {
      const controller = new AbortController();
      const srv = await startHTTPServer((req, res) => {
        controller.abort();
      });
      try {
        let thrown: any;
        try {
          await axios.get(`http://127.0.0.1:${srv.port}/`, { signal: controller.signal });
        } catch (e) { thrown = e; }
        expect(thrown).toBeDefined();
        expect(thrown.code === 'ERR_CANCELED' || thrown.code === 'ECONNABORTED' || axios.isCancel(thrown)).toBe(true);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('axios.isCancel() returns true for a cancelled error', async () => {
      const err = new axios.Cancel('test cancel');
      expect(axios.isCancel(err)).toBe(true);
    });

    await it('axios.isCancel() returns false for a regular error', async () => {
      expect(axios.isCancel(new Error('regular'))).toBe(false);
    });
  });
};
