// Autobahn fuzzingclient driver — exercises globalThis.WebSocket
// (provided by @gjsify/websocket over Soup.WebsocketConnection).
//
// The Autobahn Testsuite runs as a server in Docker (see config/docker-compose.yml).
// It exposes:
//   ws://127.0.0.1:9001/getCaseCount        → responds with the total number
//                                              of test cases as a single frame
//   ws://127.0.0.1:9001/runCase?case=N&agent=X
//                                            → runs test case N, expects us to
//                                              echo every received frame back
//   ws://127.0.0.1:9001/updateReports?agent=X
//                                            → regenerates HTML/JSON reports
//                                              under reports/output/clients/
//
// The reports get validated by scripts/validate-reports.mjs against a
// committed baseline (reports/baseline/<agent>.json) — any regression in
// passed/failed/non-strict counts fails the build.
//
// Reference: refs/ws/test/autobahn.js — same structure, same agent-name convention.

// Import the WebSocket class directly from @gjsify/websocket rather than
// reading globalThis.WebSocket. The Autobahn suite tests RFC 6455 protocol
// compliance — whether the class is exposed on globalThis is orthogonal
// (tested in @gjsify/websocket's own unit spec). Explicit import keeps
// bundler dependency tracking clean and survives any future changes to
// the --globals auto detection rules.
import '@gjsify/node-globals/register';
import { WebSocket } from '@gjsify/websocket';
// `System.exit()` is the reliable GJS exit path. process.exit() from
// @gjsify/process reaches imports.system.exit via globalThis.imports, which
// is empty in GJS ESM bundles and silently no-ops. The scripts/run-driver.mjs
// wrapper watchdogs the "Done." log marker and SIGKILLs after a grace period
// as a safety net for cases where System.exit() itself doesn't terminate.
import { exit as systemExit } from 'system';
// @gjsify/websocket uses Soup.Session internally, which needs a running
// GLib main loop for async I/O. ensureMainLoop() kicks it off so our
// `await new Promise(...)` over WebSocket events actually resolves.
import { ensureMainLoop } from '@gjsify/utils';
ensureMainLoop();

const AUTOBAHN_URL = 'ws://127.0.0.1:9001';
const AGENT = 'gjsify-websocket';

// Deflate must be opted in explicitly — @gjsify/websocket defaults to false
// to avoid corrupted round-trips with local Soup.Server fixtures in unit tests.
const WS_OPTS = { perMessageDeflate: true };

function connect(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${AUTOBAHN_URL}${path}`, undefined, WS_OPTS);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', (ev: any) => reject(
      new Error(`WebSocket error: ${ev?.message ?? 'unknown'}`),
    ), { once: true });
  });
}

function waitClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
  });
}

function getCaseCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${AUTOBAHN_URL}/getCaseCount`, undefined, WS_OPTS);
    let count = -1;
    ws.addEventListener('message', (ev: any) => {
      count = parseInt(String(ev?.data ?? ''), 10);
    });
    ws.addEventListener('close', () => {
      if (count > 0) resolve(count);
      else reject(new Error('Autobahn returned no case count — is the fuzzingserver running on port 9001?'));
    });
    ws.addEventListener('error', (ev: any) => reject(
      new Error(`Failed to query case count: ${ev?.message ?? 'unknown'}`),
    ));
  });
}

// Upper bound per case. Most cases complete in < 1 s, but the largest
// permessage-deflate cases (12.2.10+, 12.3.10+, 12.5.17 — 1000 messages
// at 131 072 bytes each, ~128 MB roundtrip through GJS) legitimately need
// 10–30 s. Autobahn's own server-side timeout is 60 s for these. We
// match that so genuine slow cases pass while still catching real hangs
// in well under a minute.
const CASE_TIMEOUT_MS = 60_000;

function waitCloseWithTimeout(ws: WebSocket, timeoutMs: number): Promise<'ok' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(1001, 'autobahn driver case timeout'); } catch { /* ignore */ }
      resolve('timeout');
    }, timeoutMs);

    ws.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve('ok');
    }, { once: true });
  });
}

async function runCase(n: number, total: number): Promise<void> {
  // One line per case — lots of output but trivially grep-able and keeps
  // stuck cases obvious in CI logs.
  process.stdout.write(`[${n}/${total}] `);
  const ws = await connect(`/runCase?case=${n}&agent=${AGENT}`);
  ws.addEventListener('message', (ev: any) => {
    // Echo back exactly as received — Autobahn checks we preserve frame type,
    // payload bytes, and honor fragmentation/control-frame invariants.
    try { ws.send(ev.data); }
    catch { /* send after close — Autobahn is already moving to the next case */ }
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
      // Individual case failure must not abort the whole run — Autobahn
      // records the failure in its own report and we want a full matrix.
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
