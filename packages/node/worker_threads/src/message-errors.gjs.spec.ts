// SPDX-License-Identifier: MIT
// @gjsify/worker_threads — a message that ARRIVES but cannot be decoded.
//
// The sender-side half of this (`postMessage` throwing `DataCloneError`) is
// cross-platform and lives in `message-errors.spec.ts`. This file is the
// receiver's half: Node reports a message it cannot deserialise as
// `'messageerror'` on the receiving port or worker and stays usable, rather
// than dropping it. Ours dropped it at every seam:
//
//   parent→child  the bootstrap's decode threw out of `dispatchLine` into
//                 `readNext`'s catch, which reported a 'bootstrap message
//                 error' to the parent and shut the child down — one bad
//                 message killed the worker.
//   child→parent  `Worker._readMessages` had read, parse and dispatch under
//                 one `catch {}`, so a decode failure silently ENDED the read
//                 loop: no event, and every later message lost too.
//
// GJS-only (rule 2b): provoking it means putting a line on the wire that the
// encoder would never produce, which takes the private `_stdinPipe` in one
// direction and a raw fd-1 write from inside the child in the other. Node has
// no equivalent — its structured clone is in-process, so there is no wire to
// corrupt and no portable way to reach this path.

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker, MessageChannel } from 'node:worker_threads';
import { MessageChannel as SharedMessageChannel } from '@gjsify/message-channel';
import type Gio from '@girs/gio-2.0';

/**
 * A wire line the codec accepts structurally but cannot decode: the `BigInt`
 * tag is well-formed, and `BigInt('nope')` throws inside `decode`. Corrupting
 * the JSON itself would not do — that is a parse failure, which means "the
 * stream is broken", not "this one message is".
 */
const UNDECODABLE_PAYLOAD = { __gjsify: 'BigInt', value: 'nope' };

const UNDECODABLE_LINE = JSON.stringify({ type: 'message', data: UNDECODABLE_PAYLOAD }) + '\n';

/** Push a raw line into the child's stdin, bypassing `Worker.postMessage`. */
function writeRawLine(worker: Worker, line: string): void {
    const pipe = (worker as unknown as { _stdinPipe: Gio.OutputStream | null })._stdinPipe;
    pipe?.write_all(new TextEncoder().encode(line), null);
}

/** Collect the next `count` messages from a worker. */
function collect(worker: Worker, count: number, timeoutMs = 5000): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        const seen: unknown[] = [];
        const timer = setTimeout(
            () => reject(new Error(`only ${seen.length} of ${count} messages within ${timeoutMs} ms`)),
            timeoutMs,
        );
        worker.on('message', (msg: unknown) => {
            seen.push(msg);
            if (seen.length === count) {
                clearTimeout(timer);
                resolve(seen);
            }
        });
        worker.once('error', (err: Error) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

export default async () => {
    await on('Gjs', async () => {
        await describe("Worker — an undecodable message becomes 'messageerror'", async () => {
            await it('reports it on parentPort and keeps the child alive', async () => {
                const worker = new Worker(
                    `parentPort.on('messageerror', (err) => {
                         parentPort.postMessage('messageerror:' + (err && err.name));
                     });
                     parentPort.on('message', (msg) => {
                         parentPort.postMessage('message:' + msg);
                     });`,
                    { eval: true },
                );
                try {
                    const messages = collect(worker, 2);
                    writeRawLine(worker, UNDECODABLE_LINE);
                    // The ping is the liveness half: pre-fix the child was gone
                    // by now and this never came back.
                    worker.postMessage('ping');
                    expect(await messages).toStrictEqual(['messageerror:SyntaxError', 'message:ping']);
                } finally {
                    await worker.terminate();
                }
            });

            await it('reports it on the Worker and keeps reading', async () => {
                // The child writes the bad line straight to fd 1, the same
                // unbuffered stream the bootstrap's own `send` uses, so it
                // reaches the parent's reader ahead of the good message below.
                const worker = new Worker(
                    `const Gio = imports.gi.Gio;
                     const out = Gio.UnixOutputStream.new(1, false);
                     out.write_all(new TextEncoder().encode(
                         ${JSON.stringify(UNDECODABLE_LINE)}
                     ), null);
                     parentPort.postMessage('after');`,
                    { eval: true },
                );
                try {
                    const errored = new Promise<Error>((resolve, reject) => {
                        worker.once('messageerror', (err: Error) => resolve(err));
                        setTimeout(() => reject(new Error('no messageerror within 5000 ms')), 5000);
                    });
                    // 'after' is the read loop's liveness: pre-fix the decode
                    // failure ended it and nothing arrived again.
                    const [message] = await collect(worker, 1);
                    expect((await errored).name).toBe('SyntaxError');
                    expect(message).toBe('after');
                } finally {
                    await worker.terminate();
                }
            });
        });

        await describe("a port's undecodable message becomes 'messageerror'", async () => {
            // The child writes the bad line to fd 1 itself, addressed to the
            // port it was handed by its wire id.
            const SEND_BAD_FROM_CHILD = `parentPort.on('message', (msg) => {
                     const Gio = imports.gi.Gio;
                     const out = Gio.UnixOutputStream.new(1, false);
                     out.write_all(new TextEncoder().encode(JSON.stringify({
                         __msgport: msg.port._wireId, op: 'send', data: ${JSON.stringify(UNDECODABLE_PAYLOAD)}
                     }) + '\\n'), null);
                     msg.port.postMessage('after');
                 });`;

            await it('reaches onmessageerror of a raw shared port in the parent', async () => {
                const worker = new Worker(SEND_BAD_FROM_CHILD, { eval: true });
                try {
                    const { port1, port2 } = new SharedMessageChannel();
                    const errored = new Promise<string>((resolve, reject) => {
                        setTimeout(() => reject(new Error('no messageerror within 5000 ms')), 5000);
                        port1.onmessageerror = (event) => resolve(event.type);
                    });
                    const after = new Promise<unknown>((resolve) => {
                        port1.onmessage = (event) => resolve(event.data);
                    });
                    worker.postMessage({ port: port2 }, [port2 as never]);
                    expect(await errored).toBe('messageerror');
                    // The channel survives: the good message behind it arrives.
                    expect(await after).toBe('after');
                    port1.close();
                } finally {
                    await worker.terminate();
                }
            });

            await it('reaches both surfaces of a wrapper port in the parent', async () => {
                const worker = new Worker(SEND_BAD_FROM_CHILD, { eval: true });
                try {
                    const { port1, port2 } = new MessageChannel();
                    const viaEmitter = new Promise<Error>((resolve) => port1.once('messageerror', resolve));
                    const viaDom = new Promise<string>((resolve) => {
                        port1.onmessageerror = (event: { type: string }) => resolve(event.type);
                    });
                    port1.on('message', () => {});
                    worker.postMessage({ port: port2 }, [port2]);
                    expect((await viaEmitter).name).toBe('SyntaxError');
                    expect(await viaDom).toBe('messageerror');
                    port1.close();
                } finally {
                    await worker.terminate();
                }
            });

            await it('reaches onmessageerror of a port inside the child', async () => {
                const worker = new Worker(
                    `parentPort.on('message', (msg) => {
                         msg.port.onmessageerror = (event) => parentPort.postMessage('child:' + event.type);
                         parentPort.postMessage('ready');
                     });`,
                    { eval: true },
                );
                try {
                    const { port2 } = new MessageChannel();
                    const messages = collect(worker, 2);
                    worker.postMessage({ port: port2 }, [port2]);
                    const registry = (worker as unknown as { _portRegistry: Map<number, unknown> })._portRegistry;
                    // Wait for 'ready' by way of the collector, then poke the port.
                    await new Promise<void>((resolve) => worker.once('message', () => resolve()));
                    const [portId] = [...registry.keys()];
                    writeRawLine(worker, JSON.stringify({ __msgport: portId, op: 'send', data: UNDECODABLE_PAYLOAD }) + '\n');
                    expect(await messages).toStrictEqual(['ready', 'child:messageerror']);
                } finally {
                    await worker.terminate();
                }
            });
        });

        await describe('Worker — a thrown error keeps its class', async () => {
            await it('delivers a SyntaxError as a SyntaxError', async () => {
                const worker = new Worker(`throw new SyntaxError('bad-syntax');`, { eval: true });
                const error = await new Promise<Error>((resolve, reject) => {
                    setTimeout(() => reject(new Error('no error within 5000 ms')), 5000);
                    worker.once('error', resolve);
                });
                expect(error.name).toBe('SyntaxError');
                expect(error.message).toBe('bad-syntax');
                expect(error instanceof SyntaxError).toBe(true);
            });
        });
    });
};
