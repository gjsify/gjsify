// SPDX-License-Identifier: MIT
// What a payload costs across the boundary — the number that decides whether a
// worker is worth having at all (stamped measured ~190 ms for 10k rows).
//
// Three columns per size:
//   round-trip  — parent postMessage → worker → parent, wall clock
//   encode      — encodeWire + JSON.stringify on the parent, in isolation
//   JSON only   — JSON.stringify + JSON.parse, the floor the codec sits on
//
// Plus a 1 MB Uint8Array, where the tagged codec has to go through base64.

import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import { Worker } from '@gjsify/worker_threads';
import {
    encode as encodeWire,
    decode as decodeWire,
} from '../../../../packages/node/worker_threads/src/structured-clone-wire.ts';

const WORKER = new URL('../src/fixtures/echo.worker.mjs', import.meta.url);

const makeRows = (n: number) => {
    const rows = new Array(n);
    for (let i = 0; i < n; i++) {
        rows[i] = {
            id: i,
            name: `item-${i}`,
            qty: i % 97,
            price: (i % 1000) / 100,
            active: i % 3 === 0,
            note: 'lorem ipsum dolor sit amet consectetur',
        };
    }
    return rows;
};

const worker = new Worker(WORKER);

await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('worker never became ready')), 5000);
    worker.on('message', (m: any) => {
        if (m?.type === 'ready') {
            clearTimeout(t);
            resolve();
        }
    });
    worker.on('error', reject);
});

const ask = (msg: unknown, ms = 60000) =>
    new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        const onMessage = (m: any) => {
            if (m?.type === 'ready') return;
            clearTimeout(t);
            worker.off('message', onMessage);
            resolve(m);
        };
        worker.on('message', onMessage);
        worker.postMessage(msg);
    });

const ms = (f: () => void) => {
    const t0 = Date.now();
    f();
    return Date.now() - t0;
};

// Warm up: first round trip pays for the child's module graph.
await ask({ type: 'rows', n: 1 });

console.log('rows   direction      round-trip   encode(parent)   JSON.stringify+parse   wire bytes');

for (const n of [100, 1000, 10000]) {
    const rows = makeRows(n);

    const t0 = Date.now();
    const up = await ask({ type: 'echo', value: rows });
    const roundTripUp = Date.now() - t0;
    if (!Array.isArray(up.value) || up.value.length !== n) throw new Error('echo lost rows');

    const t1 = Date.now();
    const down = await ask({ type: 'rows', n });
    const roundTripDown = Date.now() - t1;
    if (down.rows.length !== n) throw new Error('rows lost');

    let wire = '';
    const enc = ms(() => {
        wire = JSON.stringify(encodeWire({ type: 'echo', value: rows }));
    });
    const dec = ms(() => {
        decodeWire(JSON.parse(wire));
    });
    const plain = ms(() => {
        JSON.parse(JSON.stringify({ type: 'echo', value: rows }));
    });

    console.log(
        `${String(n).padStart(5)}  parent→worker  ${String(roundTripUp).padStart(7)}ms   ${String(enc).padStart(7)}ms (dec ${dec}ms)   ${String(plain).padStart(10)}ms   ${(wire.length / 1024).toFixed(0)} KiB`,
    );
    console.log(`${String(n).padStart(5)}  worker→parent  ${String(roundTripDown).padStart(7)}ms`);
}

for (const bytes of [64 * 1024, 1024 * 1024]) {
    const buf = new Uint8Array(bytes).fill(7);

    // A fresh worker per size: a binary payload currently kills the child, and
    // the next size has to start from a live one.
    const bw = new Worker(WORKER);
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('spawn timeout')), 8000);
        bw.on('message', (m: any) => {
            if (m?.type === 'ready') {
                clearTimeout(t);
                resolve();
            }
        });
    });
    let childError: string | null = null;
    bw.on('error', (e: Error) => {
        childError ??= e?.message ?? String(e);
    });

    let roundTrip: number | string;
    const t0 = Date.now();
    try {
        const back = await new Promise<any>((resolve, reject) => {
            const t = setTimeout(
                () => reject(new Error(childError ? `child: ${childError}` : 'timeout, child silent')),
                15000,
            );
            bw.on('message', (m: any) => {
                if (m?.type === 'ready') return;
                clearTimeout(t);
                resolve(m);
            });
            bw.postMessage({ type: 'echo', value: buf });
        });
        roundTrip =
            back.value instanceof Uint8Array && back.value.length === bytes
                ? `${Date.now() - t0}ms`
                : `WRONG (${back.value?.constructor?.name} len ${back.value?.length})`;
    } catch (e) {
        roundTrip = `BLOCKED (${(e as Error).message.slice(0, 60)})`;
    }
    await bw.terminate();

    let wire = '';
    const enc = ms(() => {
        wire = JSON.stringify(encodeWire({ type: 'echo', value: buf }));
    });
    const dec = ms(() => {
        decodeWire(JSON.parse(wire));
    });

    console.log(
        `Uint8Array ${(bytes / 1024).toFixed(0)} KiB: round-trip ${roundTrip}, encode ${enc}ms, decode ${dec}ms, wire ${(wire.length / 1024).toFixed(0)} KiB (${(wire.length / bytes).toFixed(2)}× the payload)`,
    );
}

// Cost of spawning a worker at all.
const spawns: number[] = [];
for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const w = new Worker(WORKER);
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('spawn timeout')), 10000);
        w.on('message', (m: any) => {
            if (m?.type === 'ready') {
                clearTimeout(t);
                resolve();
            }
        });
        w.on('error', reject);
    });
    spawns.push(Date.now() - t0);
    await w.terminate();
}
console.log(`spawn → ready: ${spawns.join('ms, ')}ms`);

worker.postMessage({ type: 'close' });
await worker.terminate();
