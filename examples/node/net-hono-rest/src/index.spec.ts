// Smoke test for hono-rest example
// Spawns the built server as subprocess, verifies CRUD endpoints, shuts down

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { get as httpGet, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

const PORT = 13002;

// Resolve the server bundle and gjsify binary relative to this bundle's URL,
// matching the pattern used in tests/integration/mcp-inspector-cli/src/helpers.ts.
// The test bundle lives at examples/node/net-hono-rest/test.{gjs,node}.mjs.
const _here = fileURLToPath(import.meta.url);
const _distUrl = new URL('dist/', `file://${_here}`);
const SERVER_BUNDLES = {
  gjs: fileURLToPath(new URL('index.gjs.js', _distUrl)),
  node: fileURLToPath(new URL('index.node.mjs', _distUrl)),
} as const;

// Full path to gjsify binary (auto-sets LD_LIBRARY_PATH / GI_TYPELIB_PATH for prebuilds).
const GJSIFY_BIN = fileURLToPath(new URL('../../../node_modules/.bin/gjsify', `file://${_here}`));

function getServerCmd(): { cmd: string; args: string[] } {
  const isGJS = typeof (globalThis as any).process?.versions?.gjs === 'string';
  return isGJS
    ? { cmd: GJSIFY_BIN, args: ['run', SERVER_BUNDLES.gjs] }
    : { cmd: 'node', args: [SERVER_BUNDLES.node] };
}

function startServer(): Promise<{ proc: ChildProcess; kill: () => void }> {
  return new Promise((resolve, reject) => {
    const { cmd, args } = getServerCmd();
    const proc = spawn(cmd, args, {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    proc.stdout!.on('data', (b: Buffer) => { stdoutBuf += b.toString('utf8'); });
    proc.stderr!.on('data', (b: Buffer) => { stderrBuf += b.toString('utf8'); });

    const timeoutMs = 15000;
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(
        `Server did not log "running at" within ${timeoutMs}ms.\nstdout: ${stdoutBuf}\nstderr: ${stderrBuf}`,
      ));
    }, timeoutMs);

    // Poll every 50 ms so the GLib event loop has time to process I/O events.
    const check = setInterval(() => {
      if (/running at|listening/i.test(stdoutBuf)) {
        clearTimeout(timer);
        clearInterval(check);
        resolve({ proc, kill: () => proc.kill('SIGTERM') });
      } else if ((proc as any).exitCode !== null) {
        clearTimeout(timer);
        clearInterval(check);
        reject(new Error(
          `Server exited before listening.\nstdout: ${stdoutBuf}\nstderr: ${stderrBuf}`,
        ));
      }
    }, 50);

    proc.on('error', (e) => {
      clearTimeout(timer);
      clearInterval(check);
      reject(e);
    });
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
