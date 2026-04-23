// Autobahn fuzzingclient driver — exercises @gjsify/ws (the npm `ws`
// wrapper in packages/node/ws/). Same protocol as fuzzingclient-driver.ts
// but imports from 'ws' (which resolves via the alias in @gjsify/resolve-npm
// to @gjsify/ws) and uses the EventEmitter API instead of W3C
// addEventListener — that's the primary surface `ws` consumers exercise.
//
// If our @gjsify/websocket driver passes N cases but this one passes M < N,
// the gap narrows down which wrapper-layer features drop frames or mis-code
// close reasons.

import '@gjsify/node-globals/register';
// Importing `ws` here goes through the bundler alias:
//   ws → @gjsify/ws → @gjsify/websocket → Soup.WebsocketConnection.
// The shape of the import matches what real npm `ws` consumers use.
import WebSocket from 'ws';
// `System.exit()` is the reliable GJS exit path. process.exit() from
// @gjsify/process reaches imports.system.exit via globalThis.imports, which
// is empty in GJS ESM bundles and silently no-ops. The scripts/run-driver.mjs
// wrapper watchdogs the "Done." log marker and SIGKILLs after a grace period
// as a safety net for cases where System.exit() itself doesn't terminate.
import { exit as systemExit } from 'system';
// @gjsify/websocket (underneath @gjsify/ws) needs a running GLib main loop
// for Soup async I/O. ensureMainLoop() kicks it off so await'ed
// WebSocket events can resolve.
import { ensureMainLoop } from '@gjsify/utils';
ensureMainLoop();

const AUTOBAHN_URL = 'ws://127.0.0.1:9001';
const AGENT = 'gjsify-ws';

function connect(path: string): Promise<InstanceType<typeof WebSocket>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${AUTOBAHN_URL}${path}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', (err: Error) => reject(err));
  });
}

function waitClose(ws: InstanceType<typeof WebSocket>): Promise<void> {
  return new Promise((resolve) => ws.once('close', () => resolve()));
}

function getCaseCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${AUTOBAHN_URL}/getCaseCount`);
    let count = -1;
    ws.on('message', (data: Buffer | string) => {
      count = parseInt(String(data), 10);
    });
    ws.once('close', () => {
      if (count > 0) resolve(count);
      else reject(new Error('Autobahn returned no case count — is the fuzzingserver running on port 9001?'));
    });
    ws.once('error', (err: Error) => reject(err));
  });
}

// Upper bound per case. Most cases complete in < 1 s, but the largest
// permessage-deflate cases (12.2.10+, 12.3.10+, 12.5.17 — 1000 messages
// at 131 072 bytes each, ~128 MB roundtrip through GJS) legitimately need
// 10–30 s. Autobahn's own server-side timeout is 60 s for these. We
// match that so genuine slow cases pass while still catching real hangs
// in well under a minute.
const CASE_TIMEOUT_MS = 60_000;

function waitCloseWithTimeout(ws: InstanceType<typeof WebSocket>, timeoutMs: number): Promise<'ok' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(1001, 'autobahn driver case timeout'); } catch { /* ignore */ }
      resolve('timeout');
    }, timeoutMs);
    ws.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve('ok');
    });
  });
}

async function runCase(n: number, total: number): Promise<void> {
  process.stdout.write(`[${n}/${total}] `);
  const ws = await connect(`/runCase?case=${n}&agent=${AGENT}`);
  // ws's EventEmitter 'message' event has signature (data, isBinary) — echo
  // preserving type so Autobahn can verify our frame routing.
  ws.on('message', (data: Buffer | string | ArrayBuffer, isBinary: boolean) => {
    try { ws.send(data, { binary: isBinary }); }
    catch { /* send after close */ }
  });
  const result = await waitCloseWithTimeout(ws, CASE_TIMEOUT_MS);
  process.stdout.write(result === 'ok' ? 'done\n' : `timeout after ${CASE_TIMEOUT_MS}ms\n`);
}

async function updateReports(): Promise<void> {
  const ws = await connect(`/updateReports?agent=${AGENT}`);
  await waitClose(ws);
}

async function main() {
  process.stdout.write(`Autobahn fuzzingclient driver — agent="${AGENT}"\n`);
  const total = await getCaseCount();
  process.stdout.write(`Running ${total} cases against ${AUTOBAHN_URL}\n`);

  for (let i = 1; i <= total; i++) {
    try {
      await runCase(i, total);
    } catch (err) {
      process.stdout.write(`failed: ${(err as Error).message}\n`);
    }
  }

  process.stdout.write('Triggering report generation...\n');
  await updateReports();
  process.stdout.write('Done. Reports under reports/output/clients/\n');
}

main()
  .then(() => systemExit(0))
  .catch((err) => {
    process.stderr.write(`driver failed: ${(err as Error).message}\n`);
    systemExit(1);
  });
