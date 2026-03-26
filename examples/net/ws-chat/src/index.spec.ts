// Smoke test for ws-chat example
// Spawns the built server as subprocess, verifies HTTP endpoints, shuts down
// (WebSocket testing is GJS-only and not covered here — HTTP REST fallback is tested)

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { get as httpGet, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 13006;

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
      if (/running at|listening|chat/i.test(stdout)) {
        clearTimeout(timeout);
        resolve({ proc, kill: () => proc.kill('SIGTERM') });
      }
    });
    proc.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

function httpGetResponse(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res: IncomingMessage) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode!, body: data }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpPostJson(url: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json' } },
      (res: IncomingMessage) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

export default async () => {
  await describe('ws-chat', async () => {
    let server: { proc: ChildProcess; kill: () => void } | null = null;
    try {
      server = await startServer();

      await it('GET / returns HTML page', async () => {
        const { status, body } = await httpGetResponse(`http://127.0.0.1:${PORT}/`);
        expect(status).toBe(200);
        expect(body).toContain('<!DOCTYPE html>');
      });

      await it('POST /send accepts a message', async () => {
        const { status, body } = await httpPostJson(`http://127.0.0.1:${PORT}/send`, {
          user: 'TestUser',
          text: 'Hello from test',
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
      });

      await it('GET /api/messages returns sent messages', async () => {
        const { status, body } = await httpGetResponse(`http://127.0.0.1:${PORT}/api/messages`);
        expect(status).toBe(200);
        const json = JSON.parse(body);
        expect(json.messages).toBeDefined();
        expect(json.messages.length).toBeGreaterThan(0);
        expect(json.messages[0].user).toBe('TestUser');
      });
    } finally {
      if (server) server.kill();
    }
  });
};
