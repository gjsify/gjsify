// SPDX-License-Identifier: MIT
// worker_threads — browser conformance tests.
//
// Validates that the native browser primitives the @gjsify/worker_threads
// browser path is built on (MessageChannel/MessagePort transfer +
// BroadcastChannel + structured clone) behave the way that implementation
// claims. Uses browser globals only — no @gjsify/* imports — per AGENTS.md
// § Browser tests. A real `new Worker(url)` round-trip needs a separately
// served worker script the single-page Playwright harness does not provide,
// so the spawn path is exercised by the GJS/Node suites instead; here we
// pin the transport primitives the wrapper forwards to.

import { run, describe, it, expect } from '@gjsify/unit';

run({
    async WorkerThreadsBrowserTest() {
        await describe('MessageChannel — transfer (worker.postMessage transferList path)', async () => {
            await it('transfers an ArrayBuffer, neutering the sender copy', async () => {
                const ch = new MessageChannel();
                const buf = new ArrayBuffer(8);
                new Uint8Array(buf).set([1, 2, 3, 4, 5, 6, 7, 8]);

                const received = await new Promise<ArrayBuffer>((resolve) => {
                    ch.port2.onmessage = (e) => resolve((e as MessageEvent).data as ArrayBuffer);
                    ch.port1.postMessage(buf, [buf]);
                });

                // After transfer the source buffer is detached (length 0).
                expect(buf.byteLength).toBe(0);
                expect(received.byteLength).toBe(8);
                expect(Array.from(new Uint8Array(received))).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
            });

            await it('clones (does not neuter) when no transferList is given', async () => {
                const ch = new MessageChannel();
                const buf = new ArrayBuffer(4);

                await new Promise<void>((resolve) => {
                    ch.port2.onmessage = () => resolve();
                    ch.port1.postMessage(buf);
                });

                // No transfer list → structured clone keeps the source intact.
                expect(buf.byteLength).toBe(4);
            });

            await it('hands a MessagePort across a channel (transfer)', async () => {
                const outer = new MessageChannel();
                const inner = new MessageChannel();

                const port = await new Promise<MessagePort>((resolve) => {
                    outer.port2.onmessage = (e) => resolve((e as MessageEvent).ports[0]);
                    outer.port1.postMessage({ port: inner.port2 }, [inner.port2]);
                });

                const pong = await new Promise<unknown>((resolve) => {
                    port.onmessage = (e) => resolve((e as MessageEvent).data);
                    inner.port1.postMessage('pong');
                });
                expect(pong).toBe('pong');
            });
        });

        await describe('structured clone — workerData envelope round-trips structured data', async () => {
            await it('preserves nested objects, arrays, Maps and typed arrays', async () => {
                const original = {
                    n: 42,
                    s: 'hello',
                    arr: [1, 2, 3],
                    nested: { a: true, b: null },
                    map: new Map<string, number>([['x', 1]]),
                    bytes: new Uint8Array([9, 8, 7]),
                };
                const clone = structuredClone(original) as typeof original;
                expect(clone).not.toBe(original);
                expect(clone.n).toBe(42);
                expect(clone.s).toBe('hello');
                expect(clone.arr).toStrictEqual([1, 2, 3]);
                expect(clone.nested.a).toBe(true);
                expect(clone.map.get('x')).toBe(1);
                expect(Array.from(clone.bytes)).toStrictEqual([9, 8, 7]);
            });
        });

        await describe('BroadcastChannel — cross-instance delivery', async () => {
            await it('delivers a message to other channels of the same name', async () => {
                const name = `wt-bc-${Math.random().toString(36).slice(2)}`;
                const a = new BroadcastChannel(name);
                const b = new BroadcastChannel(name);
                try {
                    const got = await new Promise<unknown>((resolve) => {
                        b.onmessage = (e) => resolve((e as MessageEvent).data);
                        a.postMessage({ hi: 'there' });
                    });
                    expect((got as { hi: string }).hi).toBe('there');
                } finally {
                    a.close();
                    b.close();
                }
            });

            await it('does not deliver back to the sending channel', async () => {
                const name = `wt-bc-${Math.random().toString(36).slice(2)}`;
                const a = new BroadcastChannel(name);
                const b = new BroadcastChannel(name);
                try {
                    let selfReceived = false;
                    a.onmessage = () => {
                        selfReceived = true;
                    };
                    await new Promise<void>((resolve) => {
                        b.onmessage = () => resolve();
                        a.postMessage('echo');
                    });
                    expect(selfReceived).toBe(false);
                } finally {
                    a.close();
                    b.close();
                }
            });
        });
    },
});
