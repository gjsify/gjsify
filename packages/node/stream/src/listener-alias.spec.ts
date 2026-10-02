// SPDX-License-Identifier: MIT
// Regression: `addListener` must be the SAME function as `on` on a Readable.
//
// Found via XMPP over direct TLS in postbote: `@xmpp/events`' `onoff()` resolves
// `target.addEventListener ?? target.addListener`, so @xmpp/tls subscribes to the
// gjsify TLS socket through `addListener('data', …)`. gjsify's Readable overrode
// `on()` to enter flowing mode but left `addListener` as the plain EventEmitter
// method, so the server's answer landed in the readable buffer and no 'data'
// event was ever emitted — `readableFlowing` stayed null and the XMPP stream
// sat at "opening" until the client timed out. The same call on Node works
// because `Readable.prototype.addListener === Readable.prototype.on`.
//
// The remove side is the mirror: Node defines `off` as the SAME function as its
// Readable-specific `removeListener` override, and that override re-derives
// flowing mode when the last 'readable' listener goes away. Measured on Node
// v24 (`node_ref`), each expectation below is the reference answer, not a guess.

import { describe, it, expect } from '@gjsify/unit';
import { Readable, Duplex, Transform, PassThrough } from 'node:stream';

/** A Readable that pushes `n` chunks then EOF, so flowing mode has work to do. */
function source(n: number): Readable {
    let i = 0;
    return new Readable({
        read() {
            if (i < n) {
                i++;
                this.push(`x${i}`);
            } else {
                this.push(null);
            }
        },
    });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** Node aliases the pair onto the prototype; so must every subclass inherit it. */
function proto(c: unknown): Record<string, unknown> {
    return (c as { prototype: Record<string, unknown> }).prototype;
}

export default async () => {
    await describe('Readable: addListener aliases on', async () => {
        await it('should make addListener the same function as on', async () => {
            expect(proto(Readable).addListener).toBe(proto(Readable).on);
        });

        await it('should keep the alias on an instance', async () => {
            const readable = new Readable({ read() {} });
            expect(readable.addListener).toBe(readable.on);
        });

        await it('should make off the same function as removeListener', async () => {
            expect(proto(Readable).off).toBe(proto(Readable).removeListener);
        });

        // The classes an npm consumer gets hold, not just the base.
        for (const [name, ctor] of [
            ['Duplex', Duplex],
            ['Transform', Transform],
            ['PassThrough', PassThrough],
        ] as const) {
            await it(`should carry the alias on ${name}`, async () => {
                expect(proto(ctor).addListener).toBe(proto(ctor).on);
            });
        }
    });

    await describe('Readable: addListener reaches flowing mode', async () => {
        await it('should enter flowing mode on addListener("data")', async () => {
            const readable = source(3);
            readable.addListener('data', () => {});
            expect(readable.readableFlowing).toBe(true);
        });

        await it('should drain the buffer through addListener("data")', async () => {
            const readable = source(3);
            const chunks: string[] = [];
            readable.addListener('data', (chunk) => chunks.push(String(chunk)));
            await tick();
            expect(chunks.length).toBe(3);
            expect(readable.readableLength).toBe(0);
        });

        await it('should honour pause() over addListener("data")', async () => {
            const readable = source(3);
            readable.pause();
            readable.addListener('data', () => {});
            expect(readable.readableFlowing).toBe(false);
        });

        await it('should emit "readable" for addListener("readable")', async () => {
            const readable = source(3);
            let fired = 0;
            readable.addListener('readable', () => {
                fired++;
            });
            await tick();
            expect(fired > 0).toBe(true);
        });

        await it('should enter readable mode on on("readable")', async () => {
            const readable = source(3);
            readable.on('readable', () => {});
            expect(readable.readableFlowing).toBe(false);
        });
    });

    await describe('Readable: removeListener re-derives flowing mode', async () => {
        // Node: removing the last 'data' listener clears the data-listening flag
        // but does NOT pause — `readableFlowing` stays true.
        await it('should not pause when the last "data" listener is removed', async () => {
            const readable = source(3);
            const handler = (): void => {};
            readable.on('data', handler);
            readable.removeListener('data', handler);
            expect(readable.readableFlowing).toBe(true);
        });

        await it('should not pause when the last "data" listener is off()ed', async () => {
            const readable = source(3);
            const handler = (): void => {};
            readable.on('data', handler);
            readable.off('data', handler);
            expect(readable.readableFlowing).toBe(true);
        });

        await it('should not pause on removeAllListeners("data")', async () => {
            const readable = source(3);
            readable.on('data', () => {});
            readable.removeAllListeners('data');
            expect(readable.readableFlowing).toBe(true);
        });

        // The base EventEmitter tells "remove everything" from "remove one key" by
        // ARGUMENT COUNT, so an override that forwards the parameter positionally
        // makes the no-arg form a lookup of the key "undefined" — a silent no-op that
        // took every listener with it when this override first shipped.
        await it('should clear every listener on the no-arg removeAllListeners()', async () => {
            const readable = source(3);
            readable.on('data', () => {});
            readable.on('readable', () => {});
            readable.on('end', () => {});
            readable.removeAllListeners();
            expect(readable.eventNames().length).toBe(0);
        });

        // …and the deferred re-derivation still has to run for that form.
        await it('should release readable mode on the no-arg removeAllListeners()', async () => {
            const readable = source(3);
            readable.on('readable', () => {});
            await tick();
            readable.removeAllListeners();
            await tick();
            expect(readable.readableFlowing).toBeNull();
        });

        // Node schedules the re-derivation on the next tick, so a 'data' listener
        // re-asserts flowing once the readable listener is gone.
        await it('should resume when a "readable" listener goes and a "data" one stays', async () => {
            const readable = source(3);
            readable.on('data', () => {});
            const handler = (): void => {};
            readable.on('readable', handler);
            await tick();
            readable.removeListener('readable', handler);
            await tick();
            expect(readable.readableFlowing).toBe(true);
        });

        // …and with no 'data' listener left, readable mode is released entirely.
        await it('should release readable mode when the last "readable" listener goes', async () => {
            const readable = source(3);
            const handler = (): void => {};
            readable.on('readable', handler);
            await tick();
            readable.removeListener('readable', handler);
            await tick();
            expect(readable.readableFlowing).toBeNull();
        });

        // Node's `on('data')` checks readableListening first: with a 'readable'
        // listener present the stream stays in readable mode and does not flow.
        await it('should not flow on on("data") while a "readable" listener exists', async () => {
            const readable = source(3);
            readable.on('readable', () => {});
            readable.on('data', () => {});
            expect(readable.readableFlowing).toBe(false);
            await tick();
            expect(readable.readableFlowing).toBe(false);
        });

        // Another 'readable' listener remains, so readable mode must survive the
        // removal even with a 'data' listener attached.
        await it('should leave readable mode alone while another "readable" listener remains', async () => {
            const readable = source(3);
            const first = (): void => {};
            readable.on('data', () => {});
            readable.on('readable', first);
            readable.on('readable', () => {});
            await tick();
            readable.removeListener('readable', first);
            await tick();
            expect(readable.readableFlowing).toBe(false);
        });

        // `once('readable')` holds the stream in readable mode for exactly one emission
        // and then removes itself — the case Node's `kReadableListening` sync in `on('data')`
        // exists to support. With no 'data' listener the state falls back to null.
        await it('should release readable mode once() after once("readable") fired', async () => {
            const readable = source(3);
            readable.once('readable', () => {});
            expect(readable.readableFlowing).toBe(false);
            await tick();
            expect(readable.listenerCount('readable')).toBe(0);
            expect(readable.readableFlowing).toBeNull();
        });

        // …and with a 'data' listener left, the same removal RESUMES rather than nulling.
        await it('should resume after once("readable") fired with a "data" listener', async () => {
            const readable = source(3);
            readable.once('readable', () => {});
            readable.on('data', () => {});
            expect(readable.readableFlowing).toBe(false);
            await tick();
            expect(readable.listenerCount('readable')).toBe(0);
            expect(readable.readableFlowing).toBe(true);
        });

        await it('should not read(0) on a stream destroyed right after on("readable")', async () => {
            let reads = 0;
            const readable = new Readable({
                read() {
                    reads++;
                },
            });
            readable.on('error', () => {});
            readable.on('readable', () => {});
            readable.destroy();
            await tick();
            expect(reads).toBe(0);
        });
    });
};
