#!/usr/bin/env node
// Polls ws://127.0.0.1:9001/getCaseCount until the Autobahn container is
// ready to accept connections. `docker compose up -d` returns as soon as
// the container starts, but wstest needs a few seconds to parse the config
// and bind the port — running the driver immediately races and fails with
// ECONNREFUSED.
//
// Uses raw net instead of a WebSocket library because we only need to know
// "is the TCP port accepting?" — the handshake is verified by the driver.

import net from 'node:net';

const HOST = '127.0.0.1';
const PORT = 9001;
const DEADLINE_MS = 30_000;
const POLL_INTERVAL_MS = 500;

const start = Date.now();

function probe() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port: PORT });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

async function main() {
  process.stdout.write(`Waiting for Autobahn fuzzingserver on ${HOST}:${PORT}... `);
  while (Date.now() - start < DEADLINE_MS) {
    if (await probe()) {
      process.stdout.write(`ready (${Date.now() - start} ms)\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  process.stderr.write(`timeout after ${DEADLINE_MS} ms\n`);
  process.exit(1);
}

main();
