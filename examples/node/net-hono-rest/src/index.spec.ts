// Smoke test for hono-rest example
// Spawns the built server as subprocess, verifies CRUD endpoints, shuts down

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { get as httpGet, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 13002;

function getServerCmd(): { cmd: string; args: string[] } {
  const isGJS = typeof (globalThis as any).imports?.gi !== 'undefined';
  const dist = isGJS ? 'dist/index.gjs.js' : 'dist/index.node.mjs';
  return isGJS
    ? { cmd: 'gjs', args: ['-m', join(__dirname, dist)] }
    : { cmd: 'node', args: [join(__dirname, dist)] };
}

function startServer(): Promise<{ proc: ChildProcess; kill: () => void }> {
  return new Promise((resolve, reject) => {
    const { cmd, args } = getServerCmd();
    const proc = spawn(cmd, args, {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Server startup timeout. stdout: ${stdout}`));
    }, 15000);

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (/running at|listening/i.test(stdout)) {
        clearTimeout(timeout);
        resolve({ proc, kill: () => proc.kill('SIGTERM') });
      }
    });
    proc.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

function httpGetJson(url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res: IncomingMessage) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpRequestJson(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method, headers: { 'content-type': 'application/json' } },
      (res: IncomingMessage) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

export default async () => {
  await describe('hono-rest', async () => {
    let server: { proc: ChildProcess; kill: () => void } | null = null;
    try {
      server = await startServer();

      await it('GET / returns API info', async () => {
        const { status, body } = await httpGetJson(`http://127.0.0.1:${PORT}/`);
        expect(status).toBe(200);
        expect(body.name).toBe('gjsify Todo API');
        expect(body.endpoints).toBeDefined();
      });

      await it('GET /todos returns initial todos', async () => {
        const { status, body } = await httpGetJson(`http://127.0.0.1:${PORT}/todos`);
        expect(status).toBe(200);
        expect(body.todos.length).toBeGreaterThan(0);
        expect(body.count).toBeGreaterThan(0);
      });

      await it('POST /todos creates a new todo', async () => {
        const { status, body } = await httpRequestJson(
          `http://127.0.0.1:${PORT}/todos`,
          'POST',
          { title: 'Test todo' },
        );
        expect(status).toBe(201);
        expect(body.todo.title).toBe('Test todo');
        expect(body.todo.completed).toBe(false);
      });

      await it('DELETE /todos/:id deletes a todo', async () => {
        const { status, body } = await httpRequestJson(
          `http://127.0.0.1:${PORT}/todos/1`,
          'DELETE',
        );
        expect(status).toBe(200);
        expect(body.deleted).toBeDefined();
      });
    } finally {
      if (server) server.kill();
    }
  });
};
