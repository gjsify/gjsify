// SPDX-License-Identifier: MIT
// Port-in-port across the worker boundary: a documented gap that must fail
// loudly. GJS-only because Node supports it and simply delivers the port; the
// point here is that ours says DataCloneError instead of dropping it silently
// (rule 2b).
//
// A port that crosses the boundary is routed by id over one JSON line per
// message. Carrying a further port inside such a message would need a table of
// ports per message on both ends, which is more than the wire has today.

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker, MessageChannel } from 'node:worker_threads';
import { MessageChannel as SharedMessageChannel } from '@gjsify/message-channel';

const PORT_FIXTURE = new URL('./fixtures/port-worker.mjs', import.meta.url);

function nextMessage(worker: Worker, type: string): Promise<{ type: string; name?: string }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no '${type}' message within 5000 ms`)), 5000);
        const listener = (msg: { type: string; name?: string }) => {
            if (msg.type !== type) return;
            clearTimeout(timer);
            worker.off('message', listener);
            resolve(msg);
        };
        worker.on('message', listener);
    });
}

export default async () => {
    await on('Gjs', async () => {
        await describe('Worker — port-in-port over the worker boundary', async () => {
            await it('throws DataCloneError from the parent end', async () => {
                const worker = new Worker(PORT_FIXTURE);
                try {
                    const { port1, port2 } = new MessageChannel();
                    const other = new MessageChannel();
                    worker.postMessage({ type: 'hold', port: port2 }, [port2]);
                    let name = 'none';
                    try {
                        port1.postMessage({ inner: other.port2 }, [other.port2]);
                    } catch (err) {
                        name = (err as Error).name;
                    }
                    expect(name).toBe('DataCloneError');
                } finally {
                    await worker.terminate();
                }
            });

            await it('throws DataCloneError from the child end', async () => {
                const worker = new Worker(PORT_FIXTURE);
                try {
                    const { port2 } = new MessageChannel();
                    const result = nextMessage(worker, 'port-in-port-result');
                    worker.postMessage({ type: 'port-in-port', port: port2 }, [port2]);
                    expect((await result).name).toBe('DataCloneError');
                } finally {
                    await worker.terminate();
                }
            });
        });

        // The global MessageChannel is the shared W3C one once
        // `@gjsify/message-channel/register` ran; Comlink's proxy() and a web
        // Worker hand exactly those ports to Worker.postMessage.
        await describe('Worker — a raw shared W3C port as the transferred end', async () => {
            await it('echoes through the kept end', async () => {
                const worker = new Worker(PORT_FIXTURE);
                try {
                    const { port1, port2 } = new SharedMessageChannel();
                    const reply = new Promise<{ kind: string; data: unknown }>((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('no echo within 5000 ms')), 5000);
                        port1.onmessage = (event) => {
                            clearTimeout(timer);
                            resolve(event.data as { kind: string; data: unknown });
                        };
                    });
                    worker.postMessage({ type: 'dom', port: port2 }, [port2 as never]);
                    port1.postMessage({ n: 1 });
                    const echoed = await reply;
                    expect(echoed.kind).toBe('dom');
                    expect(echoed.data).toStrictEqual({ n: 1 });
                    port1.close();
                } finally {
                    await worker.terminate();
                }
            });
        });
    });
};
