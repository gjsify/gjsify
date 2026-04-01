// Smoke test for koa-blog example
// Spawns the built server as subprocess, verifies HTML and JSON endpoints, shuts down

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 13003;

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

function httpGetResponse(url: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res: IncomingMessage) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers as Record<string, string | string[] | undefined>, body: data }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

export default async () => {
  await describe('koa-blog', async () => {
    let server: { proc: ChildProcess; kill: () => void } | null = null;
    try {
      server = await startServer();

      await it('GET / returns HTML page', async () => {
        const { status, headers, body } = await httpGetResponse(`http://127.0.0.1:${PORT}/`);
        expect(status).toBe(200);
        expect(String(headers['content-type'])).toContain('text/html');
        expect(body).toContain('Posts');
      });

      await it('GET /api/posts returns JSON', async () => {
        const { status, headers, body } = await httpGetResponse(`http://127.0.0.1:${PORT}/api/posts`);
        expect(status).toBe(200);
        const json = JSON.parse(body);
        expect(json.posts).toBeDefined();
      });
    } finally {
      if (server) server.kill();
    }
  });
};
