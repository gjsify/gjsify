// @gjsify/worker_threads × @gjsify/sab-native — cross-process SharedBuffer
// transfer. GJS-only. Exercises the full SCM_RIGHTS side-channel: parent
// SharedBuffer → Worker.postMessage(workerData) → bootstrap fd-recv loop
// → child SharedBuffer.fromFd → atomic write → parent observes via
// futex_wait / atomic_load.

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker } from 'node:worker_threads';
import { SharedBuffer, atomics, hasNativeSab } from '@gjsify/sab-native';

export default async () => {

  await on('Gjs', async () => {

    if (!hasNativeSab()) {
      await describe('SharedBuffer cross-process (worker_threads × sab-native)', async () => {
        await it('skipped — @gjsify/sab-native prebuild missing', async () => {
          expect(true).toBe(true);
        });
      });
      return;
    }

    await describe('SharedBuffer cross-process (worker_threads × sab-native)', async () => {

      await it('child writes a marker the parent reads via atomic_load_i32', async () => {
        const sb = SharedBuffer.create(64);
        atomics.store32(sb, 0, 0);

        const w = new Worker(`
          const sb = workerData.sab;
          sb._nativeHandle.atomic_store_i32(0, 42);
          parentPort.postMessage({ done: true });
        `, { eval: true, workerData: { sab: sb } });

        const msg = await new Promise<{ done: boolean }>((resolve, reject) => {
          w.once('message', (m: unknown) => resolve(m as { done: boolean }));
          w.once('error', reject);
        });

        expect(msg.done).toBe(true);
        expect(atomics.load32(sb, 0)).toBe(42);

        await w.terminate();
      });

      await it('parent writes typed values, child reads them back', async () => {
        const sb = SharedBuffer.create(64);
        sb.setInt32LE(0, -12345);
        sb.setUint32LE(4, 0xDEADBEEF);
        sb.setUint8(8, 0xAB);

        const w = new Worker(`
          const sb = workerData.sab;
          parentPort.postMessage({
            i32: sb.getInt32LE(0),
            u32: sb.getUint32LE(4),
            u8:  sb.getUint8(8),
            len: sb.byteLength,
          });
        `, { eval: true, workerData: { sab: sb } });

        const msg = await new Promise<{ i32: number; u32: number; u8: number; len: number }>((resolve, reject) => {
          w.once('message', (m: unknown) => resolve(m as { i32: number; u32: number; u8: number; len: number }));
          w.once('error', reject);
        });

        expect(msg.i32).toBe(-12345);
        expect(msg.u32).toBe(0xDEADBEEF);
        expect(msg.u8).toBe(0xAB);
        expect(msg.len).toBe(64);

        await w.terminate();
      });

      await it('Worker.postMessage delivers a SharedBuffer mid-stream (not just at construction)', async () => {
        const sb = SharedBuffer.create(64);
        atomics.store32(sb, 0, 100);

        // Worker waits for a postMessage carrying a SharedBuffer, then mutates it.
        const w = new Worker(`
          parentPort.on('message', (msg) => {
            const sb = msg.sab;
            sb._nativeHandle.atomic_store_i32(4, 777);
            parentPort.postMessage({ ack: true });
          });
        `, { eval: true });

        // Give the worker a moment to register its 'message' listener.
        await new Promise((r) => setTimeout(r, 50));

        w.postMessage({ sab: sb });

        const ack = await new Promise<{ ack: boolean }>((resolve, reject) => {
          w.once('message', (m: unknown) => resolve(m as { ack: boolean }));
          w.once('error', reject);
        });

        expect(ack.ack).toBe(true);
        expect(atomics.load32(sb, 4)).toBe(777);

        await w.terminate();
      });

      await it('atomic add round-trip — parent + child see consistent counter', async () => {
        const sb = SharedBuffer.create(64);
        atomics.store32(sb, 0, 0);

        // Child adds 5 atomically, posts back the prior-value.
        const w = new Worker(`
          const sb = workerData.sab;
          const prev = sb._nativeHandle.atomic_add_i32(0, 5);
          parentPort.postMessage({ prev });
        `, { eval: true, workerData: { sab: sb } });

        const msg = await new Promise<{ prev: number }>((resolve, reject) => {
          w.once('message', (m: unknown) => resolve(m as { prev: number }));
          w.once('error', reject);
        });

        expect(msg.prev).toBe(0);
        // Parent now adds 10 — counter should land at 15.
        atomics.add32(sb, 0, 10);
        expect(atomics.load32(sb, 0)).toBe(15);

        await w.terminate();
      });
    });

  });
};
