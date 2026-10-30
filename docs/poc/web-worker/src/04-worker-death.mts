// SPDX-License-Identifier: MIT
// #2358 — a worker that dies in a way the crash contract does not cover.
//
// The suite already proves an uncaught throw becomes `error` + `exit 1`. This
// asks about the four other ways out, because a spec Worker owes the page an
// `error` event (or at least a terminated state) for all of them:
//
//   exit          — process.exit(3) with the port still open
//   async-reject  — unhandled rejection inside a native async function
//   abort         — SIGKILL, no stderr, no exit path
//   hang          — alive but never answering
//
// For each: does the parent get `error`, `exit`, both, or silence inside 3 s?

import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import { Worker } from '@gjsify/worker_threads';

const WORKER = new URL('../src/fixtures/silent-death.worker.mjs', import.meta.url);
const WINDOW_MS = 3000;

interface Observed {
    ready: boolean;
    error: string | null;
    exit: number | null;
    stillAnswering: boolean | null;
}

const watch = async (mode: string): Promise<Observed> => {
    const w = new Worker(WORKER, { workerData: { mode } });
    const seen: Observed = { ready: false, error: null, exit: null, stillAnswering: null };
    // Our own terminate() also makes the worker exit. Anything after this flag
    // is set is us, not the worker dying on its own.
    let terminating = false;

    w.on('message', (m: any) => {
        if (m?.type === 'ready') seen.ready = true;
        if (m?.type === 'pong') seen.stillAnswering = true;
    });
    w.on('error', (e: Error) => {
        if (!terminating) seen.error ??= e?.message ?? String(e);
    });
    w.on('exit', (code: number) => {
        if (!terminating) seen.exit ??= code;
    });

    await new Promise((r) => setTimeout(r, WINDOW_MS));

    if (seen.exit === null && seen.error === null) {
        // Nothing reported. Is it even alive? Poke it.
        seen.stillAnswering = false;
        w.postMessage({ type: 'ping' });
        await new Promise((r) => setTimeout(r, 300));
    }

    terminating = true;
    await w.terminate();
    return seen;
};

console.log('mode           ready   error                        exit    alive?  verdict');

for (const mode of ['exit', 'async-reject', 'abort', 'hang']) {
    const o = await watch(mode);
    const reported = o.error !== null || o.exit !== null;
    const verdict = reported ? 'reported' : 'SILENT — parent cannot tell the worker is gone';
    console.log(
        `${mode.padEnd(14)} ${String(o.ready).padEnd(7)} ${String(o.error ?? '—')
            .slice(0, 27)
            .padEnd(28)} ${String(o.exit ?? '—').padEnd(7)} ${String(o.stillAnswering ?? '—').padEnd(7)} ${verdict}`,
    );
}

console.log('\nA spec Worker owes an `error` event for every row that says SILENT.');
