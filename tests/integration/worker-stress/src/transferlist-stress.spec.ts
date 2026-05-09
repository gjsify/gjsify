// SPDX-License-Identifier: MIT
// Original: gjsify integration suite (Workstream C)
// Stress workload exercising @gjsify/worker_threads transferList semantics
// against the in-process MessageChannel path. Designed to surface drain /
// queue / detach regressions and to give a baseline timing fixture for
// future GC / scheduling improvements.

import { describe, it, expect } from '@gjsify/unit';
import { MessageChannel, MessagePort } from 'node:worker_threads';

const CHUNK_BYTES = 64 * 1024; // 64 KiB
const CHUNK_COUNT = 256; // 16 MiB total throughput per run
const TIMEOUT_MS = 30_000;

function makeChunk(seed: number): ArrayBuffer {
  const buf = new ArrayBuffer(CHUNK_BYTES);
  const view = new Uint8Array(buf);
  // Deterministic byte pattern so the receiver can verify integrity cheaply.
  for (let i = 0; i < CHUNK_BYTES; i++) view[i] = (seed + i) & 0xff;
  return buf;
}

function verifyChunk(buf: ArrayBuffer, seed: number): boolean {
  if (buf.byteLength !== CHUNK_BYTES) return false;
  const view = new Uint8Array(buf);
  // Spot-check first byte, midpoint, last byte (full scan is wasteful at this volume).
  return view[0] === (seed & 0xff)
    && view[CHUNK_BYTES >> 1] === ((seed + (CHUNK_BYTES >> 1)) & 0xff)
    && view[CHUNK_BYTES - 1] === ((seed + CHUNK_BYTES - 1) & 0xff);
}

export default async () => {
  await describe('transferList stress — bulk ArrayBuffer transfer', async () => {
    await it(`transfers ${CHUNK_COUNT} chunks (${(CHUNK_BYTES * CHUNK_COUNT / 1024 / 1024).toFixed(0)} MiB) without loss or corruption`, async () => {
      const channel = new MessageChannel();
      const recvSeeds: number[] = [];
      const recvSizes: number[] = [];

      const drained = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('transfer drain timeout')), TIMEOUT_MS);
        channel.port2.on('message', (msg: unknown) => {
          const { seed, buf } = msg as { seed: number; buf: ArrayBuffer };
          recvSeeds.push(seed);
          recvSizes.push(buf.byteLength);
          if (!verifyChunk(buf, seed)) {
            clearTimeout(timer);
            reject(new Error(`chunk corruption at seed=${seed}`));
            return;
          }
          if (recvSeeds.length === CHUNK_COUNT) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      const senderBuffers: ArrayBuffer[] = [];
      const startMs = Date.now();
      for (let i = 0; i < CHUNK_COUNT; i++) {
        const buf = makeChunk(i);
        senderBuffers.push(buf);
        channel.port1.postMessage({ seed: i, buf }, [buf]);
      }
      await drained;
      const elapsedMs = Date.now() - startMs;

      // All receiver chunks arrived in order, all valid.
      expect(recvSeeds.length).toBe(CHUNK_COUNT);
      for (let i = 0; i < CHUNK_COUNT; i++) {
        expect(recvSeeds[i]).toBe(i);
        expect(recvSizes[i]).toBe(CHUNK_BYTES);
      }

      // Sender buffers must all be detached (byteLength === 0).
      let detached = 0;
      for (const b of senderBuffers) if (b.byteLength === 0) detached++;
      expect(detached).toBe(CHUNK_COUNT);

      // Throughput baseline — informational, no hard threshold (varies wildly
      // by hardware). Just record it so future runs can detect regressions
      // visually in CI logs.
      const totalMiB = (CHUNK_BYTES * CHUNK_COUNT) / 1024 / 1024;
      const mibPerSec = (totalMiB * 1000) / Math.max(1, elapsedMs);
      // eslint-disable-next-line no-console
      console.log(`[worker-stress] transferList: ${totalMiB.toFixed(1)} MiB in ${elapsedMs} ms (${mibPerSec.toFixed(0)} MiB/s)`);

      channel.port1.close();
      channel.port2.close();
    });

    await it('multi-channel fan-out (4 channels × 64 chunks) preserves per-channel ordering', async () => {
      const PARALLEL = 4;
      const PER_CHANNEL = 64;

      const senderBuffers: ArrayBuffer[][] = [];
      const recvByChannel: number[][] = [];
      for (let i = 0; i < PARALLEL; i++) {
        senderBuffers.push([]);
        recvByChannel.push([]);
      }

      const channels = Array.from({ length: PARALLEL }, () => new MessageChannel());
      const allDone = channels.map((channel, idx) => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`channel ${idx} timeout`)), TIMEOUT_MS);
        channel.port2.on('message', (msg: unknown) => {
          const { seed, buf } = msg as { seed: number; buf: ArrayBuffer };
          if (!verifyChunk(buf, seed)) {
            clearTimeout(timer);
            reject(new Error(`channel ${idx}: chunk corruption seed=${seed}`));
            return;
          }
          recvByChannel[idx]!.push(seed);
          if (recvByChannel[idx]!.length === PER_CHANNEL) {
            clearTimeout(timer);
            resolve();
          }
        });
      }));

      // Interleave sends across channels.
      for (let i = 0; i < PER_CHANNEL; i++) {
        for (let c = 0; c < PARALLEL; c++) {
          const seed = c * 1000 + i;
          const buf = makeChunk(seed);
          senderBuffers[c]!.push(buf);
          channels[c]!.port1.postMessage({ seed, buf }, [buf]);
        }
      }

      await Promise.all(allDone);

      for (let c = 0; c < PARALLEL; c++) {
        expect(recvByChannel[c]!.length).toBe(PER_CHANNEL);
        // Per-channel FIFO: seeds arrive in increasing order.
        for (let i = 0; i < PER_CHANNEL; i++) {
          expect(recvByChannel[c]![i]).toBe(c * 1000 + i);
        }
        for (const b of senderBuffers[c]!) expect(b.byteLength).toBe(0);
      }

      for (const ch of channels) {
        ch.port1.close();
        ch.port2.close();
      }
    });

    await it('MessagePort transfer chain — port hops 5 links and round-trips a payload', async () => {
      // chain[0] ←─ ... ←─ chain[N-1].port1
      // Send chain[N-1].port1 hop-by-hop until it lands at chain[0]; then
      // round-trip a payload through the surviving link.
      const HOPS = 5;
      const links = Array.from({ length: HOPS + 1 }, () => new MessageChannel());
      // Inner payload channel
      const inner = new MessageChannel();
      let currentPort: MessagePort = inner.port1;

      // Pre-attach receiver listeners so each hop forwards immediately.
      for (let i = 0; i < HOPS; i++) {
        const here = links[i]!;
        const next = links[i + 1]!;
        here.port2.on('message', (msg: unknown) => {
          const { port } = msg as { port: MessagePort };
          next.port1.postMessage({ port }, [port]);
        });
      }

      const finalPortPromise = new Promise<MessagePort>((resolve) => {
        links[HOPS]!.port2.on('message', (msg: unknown) => {
          resolve((msg as { port: MessagePort }).port);
        });
      });

      // Kick off the chain.
      links[0]!.port1.postMessage({ port: currentPort }, [currentPort]);
      const finalPort = await finalPortPromise;
      expect(finalPort instanceof MessagePort).toBe(true);

      // Round-trip a payload: finalPort ↔ inner.port2.
      const echoed = await new Promise<unknown>((resolve) => {
        inner.port2.on('message', (msg) => {
          inner.port2.postMessage({ echo: msg });
        });
        finalPort.on('message', (msg: unknown) => resolve(msg));
        finalPort.postMessage('chain-ping');
      });
      expect(echoed).toStrictEqual({ echo: 'chain-ping' });

      finalPort.close();
      inner.port2.close();
      for (const link of links) {
        link.port1.close();
        link.port2.close();
      }
    });
  });
};
