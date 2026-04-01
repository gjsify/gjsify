// Smoke test for express-hello example
// Spawns the built server as subprocess, verifies HTTP endpoints, shuts down

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 13001;

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

export default async () => {
  await describe('express-hello', async () => {
    let server: { proc: ChildProcess; kill: () => void } | null = null;
    try {
      server = await startServer();

      await it('GET / returns welcome JSON', async () => {
        const { status, body } = await httpGetJson(`http://127.0.0.1:${PORT}/`);
        expect(status).toBe(200);
        expect(body.message).toContain('Hello from Express');
      });

      await it('GET /api/hello/:name returns greeting', async () => {
        const { status, body } = await httpGetJson(`http://127.0.0.1:${PORT}/api/hello/world`);
        expect(status).toBe(200);
        expect(body.greeting).toBe('Hello, world!');
      });

      await it('GET /api/time returns ISO timestamp', async () => {
        const { status, body } = await httpGetJson(`http://127.0.0.1:${PORT}/api/time`);
        expect(status).toBe(200);
        expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    } finally {
      if (server) server.kill();
    }
  });
};
