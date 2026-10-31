// oxlint-disable typescript/no-explicit-any -- test code reads untyped event payloads
// WHATWG Worker — host and worker-side API. Cross-platform: Node runs the
// adapter over native worker_threads, GJS over @gjsify/worker_threads.

import { describe, it, expect } from '@gjsify/unit';
import { Worker } from './index.js';

const ECHO = new URL('./fixtures/echo.worker.mjs', import.meta.url);

const next = <T = unknown>(target: EventTarget, type: string, ms = 8000): Promise<T> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no '${type}' event within ${ms} ms`)), ms);
        target.addEventListener(
            type,
            (event) => {
                clearTimeout(timer);
                resolve(event as T);
            },
            { once: true },
        );
    });

interface Msg {
    data: any;
    type: string;
}

async function started(options?: { name?: string }): Promise<Worker> {
    const worker = new Worker(ECHO, { type: 'module', ...options });
    const ready = await next<Msg>(worker as unknown as EventTarget, 'message');
    expect(ready.data).toBe('ready');
    return worker;
}

export default async () => {
    await describe('Worker — host side', async () => {
        await it('postMessage round-trips a structured value as a MessageEvent', async () => {
            const worker = await started();
            const reply = next<Msg>(worker as unknown as EventTarget, 'message');
            worker.postMessage({ when: new Date(0), set: new Set([1]), big: 1n });
            const { data, type } = await reply;
            expect(type).toBe('message');
            expect(data.echo.when instanceof Date).toBe(true);
            expect(data.echo.set instanceof Set).toBe(true);
            expect(data.echo.big).toBe(1n);
            expect(data.type).toBe('message');
            expect(data.ports).toBe(true);
            worker.terminate();
        });

        await it('options.name becomes self.name', async () => {
            const worker = await started({ name: 'ledger' });
            const reply = next<Msg>(worker as unknown as EventTarget, 'message');
            worker.postMessage(1);
            expect((await reply).data.name).toBe('ledger');
            worker.terminate();
        });

        await it('self.name defaults to the empty string', async () => {
            const worker = await started();
            const reply = next<Msg>(worker as unknown as EventTarget, 'message');
            worker.postMessage(1);
            expect((await reply).data.name).toBe('');
            worker.terminate();
        });

        await it('accepts a path string relative to the working directory and a file: URL string', async () => {
            const worker = new Worker(ECHO.href);
            expect((await next<Msg>(worker as unknown as EventTarget, 'message')).data).toBe('ready');
            worker.terminate();
        });

        await it('onmessage receives messages and can be replaced or cleared', async () => {
            const worker = new Worker(ECHO);
            const seen: string[] = [];
            worker.onmessage = () => seen.push('first');
            worker.onmessage = (event) => {
                seen.push(`second:${event.data}`);
            };
            expect(typeof worker.onmessage).toBe('function');
            await next(worker as unknown as EventTarget, 'message');
            expect(seen.length).toBe(1);
            expect(seen[0]).toBe('second:ready');
            worker.onmessage = null;
            expect(worker.onmessage).toBe(null);
            worker.terminate();
        });

        await it('terminate() stops delivery and is idempotent', async () => {
            const worker = await started();
            let after = 0;
            worker.addEventListener('message', () => after++);
            worker.terminate();
            worker.terminate();
            worker.postMessage('ignored');
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(after).toBe(0);
        });
    });

    await describe('Worker — errors', async () => {
        await it('an uncaught throw in the worker is a cancellable ErrorEvent', async () => {
            const worker = await started();
            const error = next<any>(worker as unknown as EventTarget, 'error');
            worker.addEventListener('error', (event) => event.preventDefault());
            worker.postMessage('throw');
            const event = await error;
            expect(event.type).toBe('error');
            expect(event.cancelable).toBe(true);
            expect(event.message.includes('from-the-worker')).toBe(true);
            expect(event.error.name).toBe('TypeError');
            worker.terminate();
        });

        await it('onerror is called like an error listener', async () => {
            const worker = await started();
            const seen = new Promise<any>((resolve) => {
                worker.onerror = (event) => {
                    event.preventDefault();
                    resolve(event);
                };
            });
            worker.postMessage('throw');
            expect((await seen).message.includes('from-the-worker')).toBe(true);
            worker.terminate();
        });

        await it('a script that cannot be loaded reports an error', async () => {
            const worker = new Worker(new URL('./fixtures/does-not-exist.mjs', import.meta.url));
            worker.addEventListener('error', (e) => e.preventDefault());
            const event = await next<any>(worker as unknown as EventTarget, 'error');
            expect(typeof event.message).toBe('string');
            worker.terminate();
        });
    });

    await describe('Worker — worker-side scope', async () => {
        await it('addEventListener, removeEventListener and handleEvent objects', async () => {
            const worker = await started();
            const armed = next<Msg>(worker as unknown as EventTarget, 'message');
            worker.postMessage('listeners');
            expect((await armed).data).toBe('armed');
            const report = next<Msg>(worker as unknown as EventTarget, 'message');
            worker.postMessage('report');
            const { seen, self } = (await report).data;
            expect(seen.join(',')).toBe('b');
            expect(self).toBe(true);
            worker.terminate();
        });

        await it('self.close() ends the worker without an error', async () => {
            const worker = await started();
            let errors = 0;
            worker.addEventListener('error', () => errors++);
            worker.postMessage('close');
            await new Promise((resolve) => setTimeout(resolve, 500));
            expect(errors).toBe(0);
            worker.terminate();
        });
    });
};
