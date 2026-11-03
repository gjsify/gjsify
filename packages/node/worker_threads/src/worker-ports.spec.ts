// SPDX-License-Identifier: MIT
// Ports across the worker boundary, seen from both ends — Node is the oracle.
//
// What Comlink (and anything else written against the web) needs from a port
// that crossed into a worker child, and from one that came back out:
//   - the DOM surface next to the EventEmitter one: addEventListener,
//     onmessage, MessageEvent-shaped `{ data }`;
//   - `MessageChannel` in the child;
//   - a port created in the child and sent to the parent;
//   - a worker that exits non-zero on purpose is not a worker that crashed.
//
// The fixtures are raw .mjs (`fixtures/port-worker.mjs`, `exit-code-worker.mjs`,
// `import-failure-worker.mjs`), so the same file runs against real
// `node:worker_threads` in the Node leg and pins the behaviour we copy.
//
// Port-in-port is a documented gap, not a feature, so it is only asserted on
// GJS (`worker-ports.gjs.spec.ts`).

import { describe, it, expect } from '@gjsify/unit';
import { Worker, MessageChannel, MessagePort } from 'node:worker_threads';

const PORT_FIXTURE = new URL('./fixtures/port-worker.mjs', import.meta.url);
const EXIT_CODE_FIXTURE = new URL('./fixtures/exit-code-worker.mjs', import.meta.url);
const IMPORT_FAILURE_FIXTURE = new URL('./fixtures/import-failure-worker.mjs', import.meta.url);

interface Reply {
    kind?: string;
    eventType?: string;
    data?: unknown;
    echoed?: unknown;
    type?: string;
    port?: MessagePort;
}

/** Queue everything an emitter delivers so a test can await it in order. */
function inbox(source: { on(event: 'message', listener: (value: Reply) => void): unknown }) {
    const items: Reply[] = [];
    const waiters: ((value: Reply) => void)[] = [];
    source.on('message', (value) => {
        const waiter = waiters.shift();
        if (waiter) waiter(value);
        else items.push(value);
    });
    return {
        next(timeoutMs = 5000, label = 'message'): Promise<Reply> {
            const ready = items.shift();
            if (ready) return Promise.resolve(ready);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`no ${label} within ${timeoutMs} ms`)), timeoutMs);
                waiters.push((value) => {
                    clearTimeout(timer);
                    resolve(value);
                });
            });
        },
        /** The next message whose `type` matches, skipping 'ready' and friends. */
        async nextOfType(type: string): Promise<Reply> {
            for (;;) {
                const value = await this.next(5000, `'${type}' message`);
                if (value.type === type) return value;
            }
        },
    };
}

function once<T>(emitter: { once(event: string, listener: (value: T) => void): unknown }, event: string) {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no '${event}' within 5000 ms`)), 5000);
        emitter.once(event, (value) => {
            clearTimeout(timer);
            resolve(value);
        });
    });
}

/** Spawn the port fixture and pass one end of a fresh channel to it. */
async function withPortWorker(
    run: (worker: Worker, fromWorker: ReturnType<typeof inbox>) => Promise<void>,
): Promise<void> {
    const worker = new Worker(PORT_FIXTURE);
    try {
        await run(worker, inbox(worker as never));
    } finally {
        await worker.terminate();
    }
}

async function expectEcho(kind: 'dom' | 'onmessage' | 'ee', expectedEventType: string | undefined) {
    await withPortWorker(async (worker) => {
        const { port1, port2 } = new MessageChannel();
        const replies = inbox(port1 as never);
        worker.postMessage({ type: kind, port: port2 }, [port2]);
        port1.postMessage({ n: 1, list: ['a', 'b'] });
        const reply = await replies.next();
        expect(reply.kind).toBe(kind);
        expect(reply.data).toStrictEqual({ n: 1, list: ['a', 'b'] });
        expect(reply.eventType).toBe(expectedEventType);
        port1.close();
    });
}

export default async () => {
    await describe('Worker — a port transferred into the worker has the DOM surface', async () => {
        await it('delivers a MessageEvent-shaped {data} to addEventListener', async () => {
            await expectEcho('dom', 'message');
        });

        await it('delivers a MessageEvent-shaped {data} to onmessage', async () => {
            await expectEcho('onmessage', 'message');
        });

        await it('still delivers plain data to on("message")', async () => {
            await expectEcho('ee', undefined);
        });

        await it('queues what arrives before a listener is attached', async () => {
            await withPortWorker(async (worker) => {
                const { port1, port2 } = new MessageChannel();
                const replies = inbox(port1 as never);
                worker.postMessage({ type: 'hold', port: port2 }, [port2]);
                port1.postMessage('early');
                await new Promise((resolve) => setTimeout(resolve, 150));
                worker.postMessage({ type: 'listen-dom' });
                const reply = await replies.next();
                expect(reply.data).toBe('early');
                port1.close();
            });
        });

        await it('tells the worker when the parent closes its end', async () => {
            await withPortWorker(async (worker, fromWorker) => {
                const { port1, port2 } = new MessageChannel();
                worker.postMessage({ type: 'watch-close', port: port2 }, [port2]);
                port1.postMessage('sync');
                await new Promise((resolve) => setTimeout(resolve, 100));
                port1.close();
                expect((await fromWorker.nextOfType('port-closed')).type).toBe('port-closed');
            });
        });

        await it('tells the parent when the worker closes its end', async () => {
            await withPortWorker(async (worker) => {
                const { port1, port2 } = new MessageChannel();
                const closed = once(port1 as never, 'close');
                worker.postMessage({ type: 'close-port', port: port2 }, [port2]);
                await closed;
            });
        });
    });

    await describe('Worker — MessageChannel inside the worker', async () => {
        await it('round-trips a structured value between its own two ports', async () => {
            await withPortWorker(async (worker, fromWorker) => {
                worker.postMessage({ type: 'channel' });
                const result = await fromWorker.nextOfType('channel-result');
                expect(result.data).toStrictEqual({ nested: [1, 2, 3] });
            });
        });
    });

    await describe('Worker — a port created in the worker and sent to the parent', async () => {
        await it('arrives as a MessagePort that talks to the kept end', async () => {
            await withPortWorker(async (worker, fromWorker) => {
                worker.postMessage({ type: 'send-port' });
                const carrier = await fromWorker.nextOfType('port');
                const port = carrier.port!;
                expect(port instanceof MessagePort).toBe(true);
                const replies = inbox(port as never);
                port.postMessage({ ping: 1 });
                expect((await replies.next()).echoed).toStrictEqual({ ping: 1 });
                port.close();
            });
        });

        await it('receives what the worker posts on the kept end right after the transfer', async () => {
            await withPortWorker(async (worker, fromWorker) => {
                worker.postMessage({ type: 'send-port-first' });
                const carrier = await fromWorker.nextOfType('port');
                const replies = inbox(carrier.port! as never);
                expect(await replies.next()).toBe('hello');
                carrier.port!.close();
            });
        });
    });

    await describe('Worker — exit codes and the error event', async () => {
        await it('exits non-zero without an error when the script chose that code', async () => {
            const worker = new Worker(EXIT_CODE_FIXTURE);
            const errors: Error[] = [];
            worker.on('error', (err: Error) => errors.push(err));
            expect(await once<number>(worker, 'exit')).toBe(3);
            expect(errors.length).toBe(0);
        });

        await it('reports a script that fails to load as one error, then exit 1', async () => {
            const worker = new Worker(IMPORT_FAILURE_FIXTURE);
            const events: string[] = [];
            worker.on('error', () => events.push('error'));
            const exitCode = once<number>(worker, 'exit').then((code) => {
                events.push('exit');
                return code;
            });
            expect(await exitCode).toBe(1);
            expect(events).toStrictEqual(['error', 'exit']);
        });
    });
};
