// SPDX-License-Identifier: MIT
// Comlink on GJS, on top of @gjsify/worker_threads.
//
// Comlink needs four things from the host: Proxy, FinalizationRegistry (for
// its release registry), a global MessageChannel (for `proxy()` callbacks and
// `createEndpoint`), and a DOM-shaped endpoint. The first three are host
// facts; the fourth is `endpointFor`, the adapter a `@gjsify/web-worker`
// Worker would make unnecessary by being DOM-shaped from the start.
//
// Each case prints PASS/FAIL. A FAIL here is a finding, not a bug in the poc.

import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import '@gjsify/message-channel/register';
import { Worker } from '@gjsify/worker_threads';
import * as Comlink from './vendor/comlink.mjs';

const WORKER = new URL('../src/fixtures/comlink.worker.mjs', import.meta.url);

console.log('host facts');
for (const [name, present] of [
    ['Proxy', typeof Proxy],
    ['FinalizationRegistry', typeof FinalizationRegistry],
    ['WeakRef', typeof WeakRef],
    ['MessageChannel (global)', typeof (globalThis as any).MessageChannel],
    ['structuredClone', typeof (globalThis as any).structuredClone],
] as const) {
    console.log(`  ${String(name).padEnd(24)} ${present}`);
}

/** EventEmitter-shaped port → DOM-shaped Comlink endpoint. */
const endpointFor = (port: any) => {
    const wrappers = new WeakMap<any, (data: unknown) => void>();
    return {
        postMessage: (msg: unknown, transfer?: unknown[]) => port.postMessage(msg, transfer),
        addEventListener: (_type: string, listener: any) => {
            const fn = (data: unknown) => {
                const handler = typeof listener === 'function' ? listener : listener.handleEvent;
                handler.call(listener, { data });
            };
            wrappers.set(listener, fn);
            port.on('message', fn);
        },
        removeEventListener: (_type: string, listener: any) => {
            const fn = wrappers.get(listener);
            if (fn) port.off('message', fn);
        },
        start: () => port.start?.(),
    };
};

const worker = new Worker(WORKER);

const ready = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    worker.on('message', (m: any) => {
        if (m?.type === 'ready') {
            clearTimeout(t);
            resolve(true);
        }
    });
    worker.on('error', (e: Error) => {
        console.log(`  worker error during startup: ${e?.message}`);
        clearTimeout(t);
        resolve(false);
    });
});

console.log(`\nworker reached Comlink.expose: ${ready}`);
if (!ready) {
    console.log('FAIL  worker never got through Comlink.expose — see error above');
    await worker.terminate();
    throw new Error('worker startup failed');
}

const api = Comlink.wrap<any>(endpointFor(worker));

let pass = 0;
let fail = 0;

const check = async (name: string, fn: () => Promise<unknown>, want: (v: any) => boolean) => {
    try {
        const v = await Promise.race([
            fn(),
            new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout after 5s')), 5000)),
        ]);
        if (want(v)) {
            pass++;
            console.log(`PASS  ${name}`);
        } else {
            fail++;
            console.log(`FAIL  ${name} — got ${JSON.stringify(v)?.slice(0, 90)}`);
        }
    } catch (e) {
        fail++;
        console.log(`FAIL  ${name} — threw ${(e as Error).message?.slice(0, 110)}`);
    }
};

console.log('');
await check(
    'GET a plain property',
    () => api.answer,
    (v) => v === 42,
);
await check(
    'APPLY a sync function',
    () => api.add(2, 3),
    (v) => v === 5,
);
await check(
    'APPLY an async function',
    () => api.slowAdd(2, 3),
    (v) => v === 5,
);
await check(
    'a throw comes back as a rejection',
    async () => {
        try {
            await api.throws();
            return 'did-not-throw';
        } catch (e) {
            return `${(e as Error).name}:${(e as Error).message}`;
        }
    },
    (v) => v === 'TypeError:from-the-worker',
);
await check(
    'structured-clone-hard return value',
    () => api.structured(),
    (v) =>
        v?.when instanceof Date &&
        v?.set instanceof Set &&
        v?.map instanceof Map &&
        typeof v?.big === 'bigint' &&
        v?.bytes instanceof Uint8Array,
);
await check(
    '1000 rows through Comlink',
    () => api.rows(1000),
    (v) => Array.isArray(v) && v.length === 1000,
);
await check(
    'Comlink.proxy() callback (parent→worker MessagePort transfer)',
    () => api.withCallback(Comlink.proxy((n: number) => n * 2)),
    (v) => v === 'callback returned 14',
);
await check(
    'createEndpoint (worker→parent MessagePort transfer)',
    async () => {
        const ep = await api[Comlink.createEndpoint]();
        const second = Comlink.wrap<any>(ep);
        return await second.add(1, 1);
    },
    (v) => v === 2,
);

const t0 = Date.now();
const ITER = 200;
for (let i = 0; i < ITER; i++) await api.add(i, 1);
const perCall = (Date.now() - t0) / ITER;
console.log(`\nComlink call latency: ${perCall.toFixed(2)} ms/call over ${ITER} sequential calls`);

const t1 = Date.now();
await api.rows(10000);
console.log(`10k rows through Comlink: ${Date.now() - t1} ms`);

console.log(`\n05-comlink-gjs: ${pass} pass, ${fail} fail`);

await worker.terminate();
