// WHATWG Worker — browser conformance tests.
//
// Validates the behaviour @gjsify/web-worker claims against the browser's own
// Worker: the same fixture, the same assertions as worker.spec.ts. Uses browser
// globals only — no @gjsify/* imports — per AGENTS.md § Browser tests. The
// worker is a Blob URL, since a browser test bundle has no fixtures directory.

import { run, describe, it, expect } from '@gjsify/unit';

const SOURCE = `
self.onmessage = (event) => {
    if (event.data === 'throw') { setTimeout(() => { throw new TypeError('from-the-worker'); }, 0); return; }
    self.postMessage({ echo: event.data, name: self.name, type: event.type, ports: Array.isArray(event.ports), same: self === globalThis });
};
self.postMessage('ready');
`;

const spawn = (name?: string): { worker: Worker; url: string } => {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
    return { worker: new Worker(url, { type: 'module', name }), url };
};

const next = <T,>(worker: Worker, type: string): Promise<T> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no '${type}' event within 8000 ms`)), 8000);
        worker.addEventListener(
            type,
            (event) => {
                clearTimeout(timer);
                resolve(event as T);
            },
            { once: true },
        );
    });

run({
    async WorkerTest() {
        await describe('Worker — host side', async () => {
            await it('round-trips a structured value as a MessageEvent', async () => {
                const { worker, url } = spawn();
                expect((await next<MessageEvent>(worker, 'message')).data).toBe('ready');
                const reply = next<MessageEvent>(worker, 'message');
                worker.postMessage({ when: new Date(0), set: new Set([1]), big: 1n });
                const { data } = await reply;
                expect(data.echo.when instanceof Date).toBe(true);
                expect(data.echo.set instanceof Set).toBe(true);
                expect(data.echo.big).toBe(1n);
                expect(data.type).toBe('message');
                expect(data.ports).toBe(true);
                expect(data.same).toBe(true);
                worker.terminate();
                URL.revokeObjectURL(url);
            });

            await it('options.name becomes self.name', async () => {
                const { worker, url } = spawn('ledger');
                await next(worker, 'message');
                const reply = next<MessageEvent>(worker, 'message');
                worker.postMessage(1);
                expect((await reply).data.name).toBe('ledger');
                worker.terminate();
                URL.revokeObjectURL(url);
            });
        });

        await describe('Worker — errors', async () => {
            await it('an uncaught throw is a cancellable ErrorEvent', async () => {
                const { worker, url } = spawn();
                await next(worker, 'message');
                worker.addEventListener('error', (event) => event.preventDefault());
                const error = next<ErrorEvent>(worker, 'error');
                worker.postMessage('throw');
                const event = await error;
                expect(event.cancelable).toBe(true);
                expect(event.message.includes('from-the-worker')).toBe(true);
                worker.terminate();
                URL.revokeObjectURL(url);
            });
        });
    },
});
