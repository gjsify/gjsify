// SPDX-License-Identifier: MIT
// @gjsify/worker_threads — what happens when a message cannot cross.
//
// SENDER side (this file). A value that cannot be serialised is a programming
// error at the call site, so both Node and HTML §2.7 report it the only way a
// caller can act on: `postMessage` throws `DataCloneError` SYNCHRONOUSLY and
// nothing is sent. Node, verbatim:
//
//     > port1.postMessage(() => {})
//     Uncaught DOMException [DataCloneError]: () => {} could not be cloned.
//
// Ours used to swallow it — `Worker.postMessage` had the whole body in a
// `try {} catch {}` meant for a closed stdin pipe, and the in-process
// `MessagePort` emitted `messageerror` on the SENDER, which is both the wrong
// end and uncatchable. Either way the caller's `postMessage` returned normally
// and the message was gone.
//
// Cross-platform on purpose: the package declares `node: "none"`, so the Node
// leg imports REAL `node:worker_threads` and these expectations are measured
// against it rather than asserted from the docs.
//
// The RECEIVER side (a message that arrives but cannot be decoded →
// `messageerror`) needs a corrupt line on the wire, which has no portable Node
// equivalent — `message-errors.gjs.spec.ts` covers it.

import { describe, it, expect } from '@gjsify/unit';
import { MessageChannel, Worker } from 'node:worker_threads';

/**
 * Runs under both runtimes, so the in-worker code is a fixture: GJS publishes
 * `parentPort` as a global, real Node's eval worker does not.
 */
const FIXTURE_URL = new URL('./fixtures/clone-error-worker.mjs', import.meta.url);

interface Reply {
    type: string;
    threw?: boolean;
    name?: string | null;
    received?: unknown[];
}

/** Send `request`, resolve with the fixture's reply of type `expected`. */
function ask(worker: Worker, request: unknown, expected: string, timeoutMs = 5000): Promise<Reply> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no '${expected}' reply within ${timeoutMs} ms`)), timeoutMs);
        const onMessage = (msg: Reply) => {
            if (msg?.type !== expected) return;
            clearTimeout(timer);
            worker.off('message', onMessage);
            resolve(msg);
        };
        worker.on('message', onMessage);
        worker.once('error', (err: Error) => {
            clearTimeout(timer);
            reject(err);
        });
        worker.postMessage(request);
    });
}

/**
 * Node's DataCloneError is a `DOMException`, GJS's is an `Error` carrying the
 * same `name`, so `name` is the portable assertion — not the constructor.
 */
function expectDataCloneError(err: unknown): void {
    expect(err).toBeDefined();
    expect((err as Error).name).toBe('DataCloneError');
}

/** Call `fn`, return what it threw, or `null` when it returned normally. */
function captureThrow(fn: () => void): unknown {
    try {
        fn();
        return null;
    } catch (err) {
        return err;
    }
}

export default async () => {
    await describe('postMessage throws DataCloneError at the sender', async () => {
        await it('throws on an in-process MessagePort', async () => {
            const channel = new MessageChannel();
            try {
                expectDataCloneError(captureThrow(() => channel.port1.postMessage(() => {})));
            } finally {
                channel.port1.close();
                channel.port2.close();
            }
        });

        await it('throws on a Worker', async () => {
            const worker = new Worker('parentPort.on("message", () => {});', { eval: true });
            try {
                expectDataCloneError(captureThrow(() => worker.postMessage(() => {})));
            } finally {
                await worker.terminate();
            }
        });

        await it('throws on parentPort inside the worker', async () => {
            const worker = new Worker(FIXTURE_URL);
            try {
                const reply = await ask(worker, { type: 'clone-throw' }, 'clone-throw');
                expect(reply.threw).toBe(true);
                expect(reply.name).toBe('DataCloneError');
            } finally {
                await worker.terminate();
            }
        });
    });

    await describe('a throwing postMessage sends nothing', async () => {
        // "Throws" alone would also be satisfied by a send that throws AFTER
        // putting something on the wire. These two pin that the receiver sees
        // the good message and ONLY the good message.
        await it('delivers only the good message on a MessagePort', async () => {
            const channel = new MessageChannel();
            try {
                const seen: unknown[] = [];
                channel.port2.on('message', (msg: unknown) => seen.push(msg));
                expectDataCloneError(captureThrow(() => channel.port1.postMessage({ fn: () => {} })));
                channel.port1.postMessage('good');
                await new Promise<void>((resolve) => setTimeout(resolve, 50));
                expect(seen).toStrictEqual(['good']);
            } finally {
                channel.port1.close();
                channel.port2.close();
            }
        });

        await it('delivers only the good message to a Worker', async () => {
            const worker = new Worker(FIXTURE_URL);
            try {
                expectDataCloneError(captureThrow(() => worker.postMessage({ fn: () => {} })));
                worker.postMessage('good');
                const reply = await ask(worker, { type: 'report' }, 'report');
                expect(reply.received).toStrictEqual(['good']);
            } finally {
                await worker.terminate();
            }
        });
    });
};
