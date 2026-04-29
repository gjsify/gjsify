// Ported from refs/axios/tests/unit/adapters/http.test.js
// Original: MIT, axios contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import axios, { isAxiosError } from 'axios';
import { startHTTPServer, stopHTTPServer, readBody } from './test-server.js';

export default async () => {
  await describe('axios: basic HTTP', async () => {
    await it('GET returns 200 and JSON body (IPv4 literal)', async () => {
      const data = { firstName: 'Fred', lastName: 'Flintstone', emailAddr: 'fred@example.com' };
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`);
        expect(response.status).toBe(200);
        expect(response.data).toStrictEqual(data);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('POST sends JSON body — server receives correct parsed body', async () => {
      const srv = await startHTTPServer(async (req, res) => {
        const body = await readBody(req);
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      });
      try {
        const payload = { title: 'gjsify test', body: 'hello' };
        const response = await axios.post(`http://127.0.0.1:${srv.port}/`, payload);
        expect(response.data.title).toBe('gjsify test');
        expect(response.data.body).toBe('hello');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('PUT sends correct HTTP method', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ method: req.method }));
      });
      try {
        const response = await axios.put(`http://127.0.0.1:${srv.port}/`);
        expect(response.data.method).toBe('PUT');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('DELETE sends correct HTTP method', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ method: req.method }));
      });
      try {
        const response = await axios.delete(`http://127.0.0.1:${srv.port}/`);
        expect(response.data.method).toBe('DELETE');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('4xx response rejects with AxiosError containing response.status', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.statusCode = 404;
        res.end('Not Found');
      });
      try {
        let error: any;
        try { await axios.get(`http://127.0.0.1:${srv.port}/`); } catch (e) { error = e; }
        expect(isAxiosError(error)).toBe(true);
        expect(error.response.status).toBe(404);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('5xx response rejects with AxiosError', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.statusCode = 500;
        res.end('Internal Server Error');
      });
      try {
        let error: any;
        try { await axios.get(`http://127.0.0.1:${srv.port}/`); } catch (e) { error = e; }
        expect(isAxiosError(error)).toBe(true);
        expect(error.response.status).toBe(500);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('validateStatus: () => true resolves even for 404', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.statusCode = 404;
        res.end('Not Found');
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`, {
          validateStatus: () => true,
        });
        expect(response.status).toBe(404);
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('response headers accessible via response.headers', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('X-Custom-Header', 'gjsify');
        res.end();
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`);
        expect(response.headers['x-custom-header']).toBe('gjsify');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('POST with plain text body — server receives raw string', async () => {
      const srv = await startHTTPServer(async (req, res) => {
        const body = await readBody(req);
        res.end(body);
      });
      try {
        const response = await axios.post(`http://127.0.0.1:${srv.port}/`, 'hello world', {
          headers: { 'Content-Type': 'text/plain' },
          responseType: 'text',
        });
        expect(response.data).toBe('hello world');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('baseURL + relative path resolved correctly', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ path: req.url }));
      });
      try {
        const response = await axios.get('/posts/1', {
          baseURL: `http://127.0.0.1:${srv.port}`,
        });
        expect(response.data.path).toBe('/posts/1');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('JSON response with UTF-8 BOM is parsed correctly', async () => {
      const srv = await startHTTPServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end('﻿{"name":"bom"}');
      });
      try {
        const response = await axios.get(`http://127.0.0.1:${srv.port}/`);
        expect(response.data.name).toBe('bom');
      } finally {
        await stopHTTPServer(srv);
      }
    });

    await it('POST Buffer body — server receives identical bytes', async () => {
      const buf = Buffer.alloc(64, 'x');
      const srv = await startHTTPServer(async (req, res) => {
        const body = await readBody(req);
        res.end(body);
      });
      try {
        const response = await axios.post(`http://127.0.0.1:${srv.port}/`, buf, {
          responseType: 'arraybuffer',
        });
        const received = Buffer.from(response.data);
        expect(received.toString()).toBe(buf.toString());
      } finally {
        await stopHTTPServer(srv);
      }
    });
  });
};
