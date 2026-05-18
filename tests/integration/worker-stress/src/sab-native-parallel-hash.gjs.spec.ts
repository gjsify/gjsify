// SPDX-License-Identifier: MIT
// GJS-only parallel SHA-256 hash workload over a @gjsify/sab-native
// SharedBuffer. Mirrors sab-parallel-hash.spec.ts but uses the
// cross-process Vala bridge instead of native SharedArrayBuffer +
// Atomics (which is unavailable in stock GJS — see STATUS.md
// "SharedArrayBuffer cross-process sharing").
//
// Layout:
//   - region[0 .. 1 MiB]                input payload
//   - barrier[0 .. WORKER_COUNT * 4]    completion barrier; each worker
//                                       stores its slot index to mark "done"
//   - digests[0 .. WORKER_COUNT * 32]   each worker writes its 32-byte SHA-256
//
// Workers run as cross-process Gio.Subprocess Workers; @gjsify/sab-native
// handles SCM_RIGHTS fd-passing so each worker mmaps the same memfd. The
// barrier uses atomics.load32 polling (futex_wake from a child works
// because we dropped the FUTEX_PRIVATE flag, but polling avoids the
// complication of having the parent main loop block on futex_wait —
// the GJS main loop is single-threaded).

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker } from 'node:worker_threads';
import { SharedBuffer, atomics, hasNativeSab } from '@gjsify/sab-native';
import { createHash } from 'node:crypto';

const PAYLOAD_BYTES = 1024 * 1024;   // 1 MiB
const WORKER_COUNT  = 4;
const SLICE_BYTES   = PAYLOAD_BYTES / WORKER_COUNT;
const BARRIER_OFF   = PAYLOAD_BYTES;          // worker_i sets *(barrier+i*4) = i+1
const DIGEST_OFF    = PAYLOAD_BYTES + WORKER_COUNT * 4; // each worker writes 32 bytes here
const REGION_BYTES  = DIGEST_OFF + WORKER_COUNT * 32;
const POLL_MS       = 2;
const TIMEOUT_MS    = 30_000;

export default async () => {

  await on('Gjs', async () => {

    if (!hasNativeSab()) {
      await describe('SAB-native parallel hash (4 workers × SHA-256)', async () => {
        await it('skipped — @gjsify/sab-native prebuild missing', async () => {
          expect(true).toBe(true);
        });
      });
      return;
    }

    await describe('SAB-native parallel hash (4 workers × SHA-256)', async () => {

      await it('main thread observes 4 worker writes via SharedBuffer + atomics barrier', async () => {
        const sb = SharedBuffer.create(REGION_BYTES);

        // Deterministic input pattern + zero barrier + zero digest slots.
        for (let i = 0; i < PAYLOAD_BYTES; i++) sb.setUint8(i, (i * 31 + 7) & 0xff);
        for (let i = 0; i < WORKER_COUNT; i++) atomics.store32(sb, BARRIER_OFF + i * 4, 0);

        // Each worker reads SLICE_BYTES from `start`, computes SHA-256
        // via GLib.Checksum, writes the 32-byte digest into the region,
        // then bumps its barrier slot to signal completion.
        const workerSrc = `
          const GLib_ = imports.gi.GLib;
          const sb = workerData.sb;
          const slot = workerData.slot;
          const start = workerData.start;
          const len = workerData.len;
          const digestOff = workerData.digestOff;
          const barrierOff = workerData.barrierOff;

          // Pull the slice out as a Uint8Array.
          const bytes = sb.readBytes(start, len);
          const cs = GLib_.Checksum.new(GLib_.ChecksumType.SHA256);
          cs.update(bytes);
          const out = new Uint8Array(32);
          let outLen = 32;
          // Vala bound get_digest variant returns the binary digest into a buffer.
          // Newer GJS exposes it as get_digest(buffer, digest_len: out) — fall back
          // to get_string + hex parse if necessary.
          try {
            cs.get_digest(out, outLen);
          } catch (_) {
            const hex = cs.get_string();
            for (let i = 0; i < 32; i++) out[i] = parseInt(hex.substr(i*2, 2), 16);
          }
          sb.writeBytes(digestOff + slot * 32, out);
          // Memory barrier: ensure digest bytes are visible before barrier slot bump.
          sb._nativeHandle.atomic_store_i32(barrierOff + slot * 4, slot + 1);
          parentPort.postMessage({ done: true });
        `;

        const workers: Worker[] = [];
        for (let i = 0; i < WORKER_COUNT; i++) {
          workers.push(new Worker(workerSrc, {
            eval: true,
            workerData: {
              sb: sb,
              slot: i,
              start: i * SLICE_BYTES,
              len: SLICE_BYTES,
              digestOff: DIGEST_OFF,
              barrierOff: BARRIER_OFF,
            },
          }));
        }

        // Wait for the barrier — every slot becomes non-zero. Spin every
        // POLL_MS via setTimeout to keep the GJS main loop responsive.
        const start = Date.now();
        await new Promise<void>((resolve, reject) => {
          const tick = () => {
            let done = 0;
            for (let i = 0; i < WORKER_COUNT; i++) {
              if (atomics.load32(sb, BARRIER_OFF + i * 4) > 0) done++;
            }
            if (done === WORKER_COUNT) return resolve();
            if (Date.now() - start > TIMEOUT_MS) {
              return reject(new Error(`barrier timeout: ${done}/${WORKER_COUNT} done after ${TIMEOUT_MS}ms`));
            }
            setTimeout(tick, POLL_MS);
          };
          tick();
        });

        // Read each worker's digest out of the region and XOR-fold.
        const folded = new Uint8Array(32);
        for (let i = 0; i < WORKER_COUNT; i++) {
          const d = sb.readBytes(DIGEST_OFF + i * 32, 32);
          for (let j = 0; j < 32; j++) folded[j] ^= d[j]!;
        }

        // Reference: compute the same digests in the parent process via
        // node:crypto (backed by @gjsify/crypto's GLib.Checksum on GJS).
        const reference = new Uint8Array(32);
        for (let i = 0; i < WORKER_COUNT; i++) {
          const slice = sb.readBytes(i * SLICE_BYTES, SLICE_BYTES);
          const d = createHash('sha256').update(slice).digest();
          for (let j = 0; j < 32; j++) reference[j] ^= d[j]!;
        }

        expect(Array.from(folded)).toStrictEqual(Array.from(reference));

        await Promise.all(workers.map(w => w.terminate()));
      });

      await it('8-worker stress: increment a shared counter 10k times each, parent observes 80k', async () => {
        const sb = SharedBuffer.create(64);
        atomics.store32(sb, 0, 0);

        const STRESS_WORKERS = 8;
        const ITER_PER_WORKER = 10_000;

        const workerSrc = `
          const sb = workerData.sb;
          const n = workerData.n;
          for (let i = 0; i < n; i++) sb._nativeHandle.atomic_add_i32(0, 1);
          parentPort.postMessage({ done: true });
        `;

        const workers: Worker[] = [];
        for (let i = 0; i < STRESS_WORKERS; i++) {
          workers.push(new Worker(workerSrc, {
            eval: true,
            workerData: { sb: sb, n: ITER_PER_WORKER },
          }));
        }

        // Wait for every worker to send 'done'.
        await Promise.all(workers.map(w => new Promise<void>((resolve, reject) => {
          w.once('message', () => resolve());
          w.once('error', reject);
        })));

        // No lost increments under contention.
        expect(atomics.load32(sb, 0)).toBe(STRESS_WORKERS * ITER_PER_WORKER);

        await Promise.all(workers.map(w => w.terminate()));
      });
    });

  });
};
