// Regression test for socket read starvation under sustained load.
//
// Root cause: when process.nextTick() was routed through GLib.idle_add(priority=100)
// instead of microtasks, it fired AFTER TCP I/O callbacks (priority=0).
// Code that schedules writes or parsing via process.nextTick (e.g. bittorrent-protocol)
// would get starved: I/O kept firing at priority 0 while nextTick callbacks at priority 100
// never got scheduled, causing buffers to overflow and throughput to drop to 0B/s.
//
// This test transfers 2MB over a loopback TCP connection using process.nextTick-driven
// write scheduling (the exact pattern bittorrent-protocol uses). It must complete within
// 10 seconds; with the bug it would hang indefinitely or time out.

import { describe, it, expect } from '@gjsify/unit';
import { createServer, connect } from 'node:net';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const CHUNK_SIZE = 16_384; // 16 KB — matches socket read buffer and typical BitTorrent block size
const NUM_CHUNKS = 128;   // 2 MB total
const TIMEOUT_MS = 10_000;

export default async () => {
  await describe('net Socket throughput', async () => {
    await it('transfers 2MB over loopback using process.nextTick-driven writes without stalling', async () => {
      const { bytesReceived, timedOut } = await new Promise<{ bytesReceived: number; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ bytesReceived: -1, timedOut: true }), TIMEOUT_MS);

        const server = createServer((conn) => {
          let sent = 0;
          const chunk = Buffer.alloc(CHUNK_SIZE, 0x42);

          // Mirrors bittorrent-protocol: schedule each successive write via nextTick
          // so that the write loop yields between chunks rather than blocking.
          function sendNext() {
            if (sent >= NUM_CHUNKS) { conn.end(); return; }
            const ok = conn.write(chunk);
            sent++;
            if (ok) process.nextTick(sendNext);
            else conn.once('drain', sendNext);
          }
          sendNext();

          conn.on('error', () => {});
        });

        server.listen(0, '127.0.0.1', () => {
          const { port } = (server.address() as { port: number });
          let received = 0;

          const client = connect(port, '127.0.0.1');

          client.on('data', (chunk) => {
            received += chunk.length;
            // Simulate protocol-layer processing scheduled via nextTick (bittorrent-protocol pattern).
            process.nextTick(() => { /* parse */ });
          });

          client.on('end', () => {
            clearTimeout(deadline);
            server.close(() => resolve({ bytesReceived: received, timedOut: false }));
          });

          client.on('error', (err) => {
            clearTimeout(deadline);
            server.close(() => resolve({ bytesReceived: received, timedOut: true }));
          });
        });

        server.on('error', () => resolve({ bytesReceived: -1, timedOut: true }));
      });

      expect(timedOut).toBeFalsy();
      expect(bytesReceived).toBe(CHUNK_SIZE * NUM_CHUNKS);
    });
  });
};
