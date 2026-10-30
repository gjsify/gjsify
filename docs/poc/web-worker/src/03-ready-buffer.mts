// SPDX-License-Identifier: MIT
// #2476 — messages posted before the worker is ready.
//
// A spec Worker has no ready event: `new Worker(url)` followed immediately by
// `postMessage(x)` must deliver x. Three things can swallow it: the parent
// writing to a stdin that is not open yet, the child reading stdin before its
// user module ran, and the child's port having no listener yet.
//
// Case A: post N messages in the same tick as the constructor.
// Case B: post N messages to a worker whose module blocks for 400 ms.
// Case C: post, then await a macrotask, then post again (the easy case).

import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import { Worker } from '@gjsify/worker_threads';

const SLOW = new URL('../src/fixtures/slow-start.worker.mjs', import.meta.url);
const ECHO = new URL('../src/fixtures/echo.worker.mjs', import.meta.url);
const N = 5;

const collect = (worker: Worker, want: number, ms: number) =>
    new Promise<{ seqs: number[]; ready: boolean }>((resolve) => {
        const seqs: number[] = [];
        let ready = false;
        const done = () => resolve({ seqs, ready });
        const t = setTimeout(done, ms);
        worker.on('message', (m: any) => {
            if (m?.type === 'ready') {
                ready = true;
                return;
            }
            if (m?.type === 'got') seqs.push(m.seq);
            if (m?.type === 'echo') seqs.push(m.value);
            if (seqs.length >= want) {
                clearTimeout(t);
                done();
            }
        });
        worker.on('error', () => {});
    });

const report = (label: string, got: number[], expect: number) => {
    const ok = got.length === expect;
    console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${label}: ${got.length}/${expect} delivered${ok ? '' : ` (arrived: ${JSON.stringify(got)})`}`,
    );
    return ok;
};

let pass = 0;
let fail = 0;

// Case A — synchronous postMessage right after the constructor.
{
    const w = new Worker(ECHO);
    for (let i = 0; i < N; i++) w.postMessage({ type: 'echo', value: i });
    const { seqs, ready } = await collect(w, N, 8000);
    report(`A same-tick post, normal worker (ready seen: ${ready})`, seqs, N) ? pass++ : fail++;
    await w.terminate();
}

// Case B — same, but the child blocks 400 ms before attaching its listener.
{
    const w = new Worker(SLOW);
    for (let i = 0; i < N; i++) w.postMessage({ seq: i });
    const { seqs, ready } = await collect(w, N, 10000);
    report(`B same-tick post, 400 ms slow-start worker (ready seen: ${ready})`, seqs, N) ? pass++ : fail++;
    await w.terminate();
}

// Case C — post after a macrotask, the case that was never in doubt.
{
    const w = new Worker(ECHO);
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < N; i++) w.postMessage({ type: 'echo', value: i });
    const { seqs } = await collect(w, N, 8000);
    report('C post after one macrotask', seqs, N) ? pass++ : fail++;
    await w.terminate();
}

// Case D — interleaved: half before ready, half after. The collector is
// attached first; attaching it after the second batch loses the replies to the
// first and measures the poc instead of the transport.
{
    const w = new Worker(SLOW);
    const collected = collect(w, 2 * N, 10000);
    for (let i = 0; i < N; i++) w.postMessage({ seq: i });
    await new Promise((r) => setTimeout(r, 600));
    for (let i = N; i < 2 * N; i++) w.postMessage({ seq: i });
    const { seqs } = await collected;
    const ordered = seqs.every((s, i) => s === i);
    console.log(
        `${seqs.length === 2 * N && ordered ? 'PASS' : 'FAIL'}  D interleaved before/after ready: ${seqs.length}/${2 * N} delivered, order ${ordered ? 'preserved' : `broken ${JSON.stringify(seqs)}`}`,
    );
    seqs.length === 2 * N && ordered ? pass++ : fail++;
    await w.terminate();
}

console.log(`\n03-ready-buffer: ${pass} pass, ${fail} fail`);
