// SPDX-License-Identifier: MIT
// #2338 — what does the bundler do with `new Worker(new URL('./x.ts', import.meta.url))`?
//
// This file is only ever *built*, never run: the question is what comes out.
// The three outcomes, in order of badness:
//
//   1. the URL is rewritten to a path next to the bundle and `compute.worker.ts`
//      is emitted as its own entry  → #2338 is already done
//   2. the URL survives verbatim and `compute.worker.ts` is NOT emitted
//      → the app ships a bundle that resolves a .ts file at runtime: broken
//   3. `compute.worker.ts` is inlined into the main bundle as a module
//      → worse than 2: the worker code is in the parent and the URL dangles
//
// `scripts/run-all.sh` greps the output and says which one happened.

import { Worker } from '@gjsify/worker_threads';

const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), {
    workerData: { probe: true },
});

worker.on('message', (m: unknown) => {
    console.log('main got', m);
});

export { worker };
