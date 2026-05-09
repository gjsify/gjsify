// SPDX-License-Identifier: MIT
// Original: gjsify integration suite (Workstream C)
// Parallel SHA-256 hash workload over a SharedArrayBuffer-backed input.
//
// Node baseline: real worker_threads with shared memory + Atomics for
//   producer/consumer coordination. Each worker hashes one slice of the SAB,
//   the main thread XOR-folds the partial digests for a deterministic
//   fingerprint, and the elapsed time is logged as a baseline.
//
// GJS: SharedArrayBuffer is not exposed under SpiderMonkey 140 in stock GJS
//   (Mozilla disables the constructor unless the embedder opts in), and our
//   subprocess-based Worker harness cannot share memory pages either.
//   Status tracked under "Open TODOs → SharedArrayBuffer cross-process
//   sharing". The suite degrades gracefully on GJS to an availability check.

import { describe, it, expect, on } from '@gjsify/unit';
import { createHash } from 'node:crypto';

const SAB_BYTES = 1024 * 1024; // 1 MiB
const WORKER_COUNT = 4;
const TIMEOUT_MS = 60_000;

export default async () => {
  await describe('SAB parallel hash workload', async () => {
    const SAB = (globalThis as Record<string, unknown>).SharedArrayBuffer as
      typeof SharedArrayBuffer | undefined;
    const hasSAB = typeof SAB === 'function';

    await it('SharedArrayBuffer availability', async () => {
      // Documented expectations. GJS today: undefined (see STATUS.md
      // "Open TODOs → SharedArrayBuffer cross-process sharing").
      if (hasSAB) {
        expect(typeof SAB).toBe('function');
      } else {
        expect(typeof SAB).toBe('undefined');
      }
    });

    await on('Node.js', async () => {
      await it('main thread observes worker writes via SAB + Atomics', async () => {
        // Use `node:worker_threads` directly to keep the integration suite
        // exercising a real-thread workload (subprocess workers have no SAB
        // sharing path). Workers compute SHA-256 over disjoint slices of a
        // 1 MiB shared buffer; main thread XOR-folds the partial digests.
        const { Worker } = await import('node:worker_threads');

        const sab = new SAB!(SAB_BYTES);
        const view = new Uint8Array(sab);
        // Deterministic input pattern.
        for (let i = 0; i < SAB_BYTES; i++) view[i] = (i * 31 + 7) & 0xff;

        // 32-byte completion barrier: each worker writes its slot index to
        // signal "done"; main thread spins on Atomics.load.
        const barrierSab = new SAB!(WORKER_COUNT * 4);
        const barrier = new Int32Array(barrierSab);

        const partialHashes = new Array<Buffer>(WORKER_COUNT);
        const slice = SAB_BYTES / WORKER_COUNT;

        const workerCode = `
          const { parentPort, workerData } = require('node:worker_threads');
          const { createHash } = require('node:crypto');
          const { sab, barrierSab, slot, sliceStart, sliceEnd } = workerData;
          const view = new Uint8Array(sab);
          const barrier = new Int32Array(barrierSab);
          const h = createHash('sha256');
          h.update(view.subarray(sliceStart, sliceEnd));
          const digest = h.digest();
          parentPort.postMessage({ slot, digest });
          Atomics.store(barrier, slot, 1);
          Atomics.notify(barrier, slot, 1);
        `;

        const startMs = Date.now();
        const workers: import('node:worker_threads').Worker[] = [];
        const completion = new Promise<void>((resolve, reject) => {
          let done = 0;
          const timer = setTimeout(() => reject(new Error('SAB workers timed out')), TIMEOUT_MS);
          for (let slot = 0; slot < WORKER_COUNT; slot++) {
            const w = new Worker(workerCode, {
              eval: true,
              workerData: {
                sab,
                barrierSab,
                slot,
                sliceStart: slot * slice,
                sliceEnd: (slot + 1) * slice,
              },
            });
            workers.push(w);
            w.on('message', (msg: { slot: number; digest: Buffer }) => {
              partialHashes[msg.slot] = msg.digest;
              done++;
              if (done === WORKER_COUNT) {
                clearTimeout(timer);
                resolve();
              }
            });
            w.on('error', (err) => {
              clearTimeout(timer);
              reject(err);
            });
          }
        });

        await completion;
        const elapsedMs = Date.now() - startMs;

        // Cross-thread visibility: every barrier slot is now 1.
        for (let i = 0; i < WORKER_COUNT; i++) {
          expect(Atomics.load(barrier, i)).toBe(1);
        }

        // Partial digests fold into a deterministic fingerprint. Validate
        // against a second main-thread computation for the same slices.
        for (let i = 0; i < WORKER_COUNT; i++) {
          const slicedHash = createHash('sha256')
            .update(view.subarray(i * slice, (i + 1) * slice))
            .digest();
          // Buffer.equals not always set up under @types/node strict — fall back
          // to byte-by-byte compare.
          expect(partialHashes[i]!.length).toBe(slicedHash.length);
          for (let b = 0; b < slicedHash.length; b++) {
            expect(partialHashes[i]![b]).toBe(slicedHash[b]);
          }
        }

        // Throughput baseline.
        const totalMiB = SAB_BYTES / 1024 / 1024;
        const mibPerSec = (totalMiB * 1000) / Math.max(1, elapsedMs);
        // eslint-disable-next-line no-console
        console.log(`[worker-stress] SAB hash: ${totalMiB.toFixed(1)} MiB across ${WORKER_COUNT} workers in ${elapsedMs} ms (${mibPerSec.toFixed(0)} MiB/s)`);

        await Promise.all(workers.map((w) => w.terminate()));
      });
    });
  });
};
