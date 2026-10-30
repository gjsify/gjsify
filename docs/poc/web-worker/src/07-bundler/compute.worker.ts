// SPDX-License-Identifier: MIT
// The worker entry the bundler is supposed to notice. The marker string is
// what `scripts/run-all.sh` greps the main bundle for: if it is in there, the
// worker was inlined into the parent instead of emitted as its own entry.

const MARKER = 'GJSIFY_WORKER_ENTRY_MARKER';

const ctx = (globalThis as Record<string, unknown>).__gjsify_worker_context as
    | { parentPort: { postMessage(v: unknown): void } }
    | undefined;

ctx?.parentPort.postMessage({ type: 'from-worker-entry', marker: MARKER });

export {};
