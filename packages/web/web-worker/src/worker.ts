// WHATWG Worker (HTML Standard § 10.2) over worker_threads.
// Reference: https://html.spec.whatwg.org/multipage/workers.html#dedicated-workers-and-the-worker-interface
//
// One implementation: the child process / thread is worker_threads' own, the
// worker-side scope is laid over its `parentPort` by `worker-scope.ts`.

import { ErrorEvent, EventTarget, MessageEvent } from '@gjsify/dom-events';
import { cwd } from 'node:process';
import { pathToFileURL } from 'node:url';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { buildWorkerSource } from './worker-scope.js';

export interface WorkerOptions {
    /** Only `'module'` is meaningful: the script is always loaded as an ES module. */
    type?: 'classic' | 'module';
    /** Becomes `self.name` inside the worker. */
    name?: string;
    credentials?: 'omit' | 'same-origin' | 'include';
}

// oxlint-disable-next-line typescript/no-explicit-any -- event type differs per attribute and lib.dom is absent on GJS
type Handler = ((event: any) => unknown) | null;

const isGjs = typeof (globalThis as { imports?: unknown }).imports === 'object';

function resolveScript(scriptURL: string | URL): string {
    if (scriptURL instanceof URL) return scriptURL.href;
    const text = String(scriptURL);
    // A scheme means an absolute URL; anything else is relative to the
    // "document", which for a program is its working directory.
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(text)) return new URL(text).href;
    return new URL(text, pathToFileURL(`${cwd()}/`)).href;
}

export class Worker extends EventTarget {
    #thread: ThreadWorker;
    #terminated = false;
    #handlers: Record<'message' | 'messageerror' | 'error', Handler> = {
        message: null,
        messageerror: null,
        error: null,
    };

    constructor(scriptURL: string | URL, options: WorkerOptions = {}) {
        super();
        const href = resolveScript(scriptURL);
        const thread = new ThreadWorker(buildWorkerSource(href, options.name ?? '', isGjs), { eval: true });
        this.#thread = thread;

        thread.on('message', (data: unknown) => {
            if (this.#terminated) return;
            this.dispatchEvent(new MessageEvent('message', { data }));
        });
        thread.on('messageerror', () => {
            if (this.#terminated) return;
            this.dispatchEvent(new MessageEvent('messageerror', { data: null }));
        });
        thread.on('error', (error: Error) => {
            if (this.#terminated) return;
            const event = new ErrorEvent('error', {
                cancelable: true,
                message: error?.message ?? String(error),
                error,
            });
            this.dispatchEvent(event);
            // The default action of an unhandled worker error is to report it.
            if (!event.defaultPrevented && this.#handlers.error === null) console.error(error);
        });
    }

    postMessage(message: unknown, transfer?: readonly unknown[] | { transfer?: readonly unknown[] }): void {
        if (this.#terminated) return;
        const list = Array.isArray(transfer) ? transfer : (transfer as { transfer?: unknown[] } | undefined)?.transfer;
        this.#thread.postMessage(message, list as never);
    }

    terminate(): void {
        if (this.#terminated) return;
        this.#terminated = true;
        this.#thread.terminate().catch(() => {});
    }

    #attribute(type: 'message' | 'messageerror' | 'error', fn: Handler): void {
        const previous = this.#handlers[type];
        if (previous) this.removeEventListener(type, previous);
        this.#handlers[type] = typeof fn === 'function' ? fn : null;
        if (this.#handlers[type]) this.addEventListener(type, this.#handlers[type]!);
    }

    get onmessage(): Handler {
        return this.#handlers.message;
    }
    set onmessage(fn: Handler) {
        this.#attribute('message', fn);
    }
    get onmessageerror(): Handler {
        return this.#handlers.messageerror;
    }
    set onmessageerror(fn: Handler) {
        this.#attribute('messageerror', fn);
    }
    get onerror(): Handler {
        return this.#handlers.error;
    }
    set onerror(fn: Handler) {
        this.#attribute('error', fn);
    }

    get [Symbol.toStringTag](): string {
        return 'Worker';
    }
}
