// SPDX-License-Identifier: MIT
// The same Comlink cases on Node, as the control.
//
// Node is where Comlink + worker_threads is supposed to be a solved problem:
// comlink ships `comlink/dist/umd/node-adapter`. So whatever fails here fails
// for everyone, and whatever passes here is the bar GJS has to reach.
//
// Run with plain node — no bundling:
//   COMLINK_ESM=<…>/comlink.mjs COMLINK_NODE_ADAPTER=<…>/node-adapter.js \
//       node docs/poc/web-worker/src/06-comlink-node.mjs

import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';

const Comlink = await import(process.env.COMLINK_ESM);
const nodeEndpoint = createRequire(import.meta.url)(process.env.COMLINK_NODE_ADAPTER);

const WORKER = new URL('./fixtures/comlink.worker.mjs', import.meta.url);

console.log('host facts');
for (const [name, present] of [
    ['Proxy', typeof Proxy],
    ['FinalizationRegistry', typeof FinalizationRegistry],
    ['MessageChannel (global)', typeof globalThis.MessageChannel],
    ['structuredClone', typeof globalThis.structuredClone],
]) {
    console.log(`  ${String(name).padEnd(24)} ${present}`);
}

const worker = new Worker(WORKER, { env: process.env });

const ready = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    worker.on('message', (m) => {
        if (m?.type === 'ready') {
            clearTimeout(t);
            resolve(true);
        }
    });
    worker.on('error', (e) => {
        console.log(`  worker error during startup: ${e?.message}`);
        clearTimeout(t);
        resolve(false);
    });
});

console.log(`\nworker reached Comlink.expose: ${ready}`);
if (!ready) {
    await worker.terminate();
    // oxlint-disable-next-line gjsify/deferred-process-exit -- module top level has no `return` to give the exit; the throw is what halts if it is ever deferred.
    process.exit(1);
    throw new Error('unreachable — process.exit(1) above');
}

const api = Comlink.wrap(nodeEndpoint(worker));

let pass = 0;
let fail = 0;

const check = async (name, fn, want) => {
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
            console.log(`FAIL  ${name} — got ${String(JSON.stringify(v)).slice(0, 90)}`);
        }
    } catch (e) {
        fail++;
        console.log(`FAIL  ${name} — threw ${String(e.message).slice(0, 110)}`);
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
            return `${e.name}:${e.message}`;
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
    () => api.withCallback(Comlink.proxy((n) => n * 2)),
    (v) => v === 'callback returned 14',
);
await check(
    'createEndpoint (worker→parent MessagePort transfer)',
    async () => {
        const ep = await api[Comlink.createEndpoint]();
        const second = Comlink.wrap(nodeEndpoint(ep));
        return await second.add(1, 1);
    },
    (v) => v === 2,
);

const ITER = 200;
const t0 = Date.now();
for (let i = 0; i < ITER; i++) await api.add(i, 1);
console.log(`\nComlink call latency: ${((Date.now() - t0) / ITER).toFixed(2)} ms/call over ${ITER} sequential calls`);

const t1 = Date.now();
await api.rows(10000);
console.log(`10k rows through Comlink: ${Date.now() - t1} ms`);

console.log(`\n06-comlink-node: ${pass} pass, ${fail} fail`);

await worker.terminate();
