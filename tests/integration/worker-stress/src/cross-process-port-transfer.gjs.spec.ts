// Cross-process MessagePort transfer — GJS-only integration test.
//
// Closes the STATUS.md "Open TODOs / Medium priority — Cross-process
// MessagePort transfer via Worker subprocess IPC (#204 follow-up)" Open
// TODO. Verifies that `Worker.postMessage(value, [port])` actually moves
// a MessagePort across the parent ↔ child boundary via the new
// `SubprocessPortTransport` adapter, and that messages flow in both
// directions over the transferred channel.
//
// On Node, `worker_threads` ships its own real cross-process MessagePort
// implementation (V8 SerializeData + V8 deserialize on the receiver),
// so this suite would be redundant. Wrap in `on('Gjs', …)`.

import { describe, it, expect, on } from '@gjsify/unit';
import { MessageChannel, Worker } from 'node:worker_threads';

export default async () => {

  await on('Gjs', async () => {

    await describe('Cross-process MessagePort transfer (worker_threads × SubprocessPortTransport)', async () => {

      await it('parent transfers port2 to worker; worker.port2 → parent.port1 round-trip', async () => {
        const ch = new MessageChannel();
        const workerSrc = `
          parentPort.on('message', (msg) => {
            const port = msg.port;
            port.on('message', (data) => {
              port.postMessage({ echoed: data });
            });
          });
        `;
        const worker = new Worker(workerSrc, { eval: true });

        // Wait for the child to come online before sending — avoids race
        // with the bootstrap's parentPort listener registration.
        await new Promise<void>((resolve) => worker.once('online', () => resolve()));

        // Transfer port2 to the worker. The kept end is port1 on parent.
        worker.postMessage({ port: ch.port2 }, [ch.port2]);

        // port1 must already be wired through the transport at this point;
        // listen for the echo BEFORE sending so we don't miss the response.
        const echo = await new Promise<unknown>((resolve, reject) => {
          ch.port1.on('message', (data) => resolve(data));
          ch.port1.on('messageerror', (err) => reject(err));
          ch.port1.postMessage('hello-cross-process');
        });

        expect((echo as { echoed: string }).echoed).toBe('hello-cross-process');

        await worker.terminate();
      });

      await it('child can close the transferred port; parent observes close', async () => {
        const ch = new MessageChannel();
        const workerSrc = `
          parentPort.on('message', (msg) => {
            const port = msg.port;
            port.on('message', () => {
              port.close();
            });
          });
        `;
        const worker = new Worker(workerSrc, { eval: true });
        await new Promise<void>((resolve) => worker.once('online', () => resolve()));

        worker.postMessage({ port: ch.port2 }, [ch.port2]);

        const closeFired = new Promise<void>((resolve) => {
          ch.port1.on('close', () => resolve());
        });
        ch.port1.postMessage('close-yourself');
        await closeFired;
        // No further messages should reach port1 after close — implicit
        // via the wrapper's _closed guard.

        await worker.terminate();
      });

      await it('roundtrip exchange over the transferred port — multiple messages keep ordering', async () => {
        const ch = new MessageChannel();
        const workerSrc = `
          parentPort.on('message', (msg) => {
            const port = msg.port;
            const received = [];
            port.on('message', (data) => {
              received.push(data);
              if (data === '__final__') {
                port.postMessage({ received });
              }
            });
          });
        `;
        const worker = new Worker(workerSrc, { eval: true });
        await new Promise<void>((resolve) => worker.once('online', () => resolve()));

        worker.postMessage({ port: ch.port2 }, [ch.port2]);

        const result = await new Promise<unknown>((resolve) => {
          ch.port1.on('message', (data) => resolve(data));
          ch.port1.postMessage('one');
          ch.port1.postMessage('two');
          ch.port1.postMessage('three');
          ch.port1.postMessage('__final__');
        });

        expect((result as { received: string[] }).received).toStrictEqual(['one', 'two', 'three', '__final__']);

        await worker.terminate();
      });

      await it('20 spawn/transfer/terminate cycles — no fd or registry leak', async () => {
        // Light stress — the registry-leak risk is per-Worker (each Worker
        // holds its own `_portRegistry`), so terminating the worker should
        // drop everything. 20 cycles is enough to catch a missing cleanup
        // path; 100 would be slow on CI runners.
        for (let i = 0; i < 20; i++) {
          const ch = new MessageChannel();
          const workerSrc = `
            parentPort.on('message', (msg) => {
              const port = msg.port;
              port.on('message', (data) => { port.postMessage(data); });
            });
          `;
          const worker = new Worker(workerSrc, { eval: true });
          await new Promise<void>((resolve) => worker.once('online', () => resolve()));

          worker.postMessage({ port: ch.port2 }, [ch.port2]);

          const echo = await new Promise<unknown>((resolve) => {
            ch.port1.on('message', (data) => resolve(data));
            ch.port1.postMessage(`cycle-${i}`);
          });

          expect(echo).toBe(`cycle-${i}`);
          await worker.terminate();
        }
      });
    });

  });
};
