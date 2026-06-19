// Test: ProcessReadStream auto-resume on 'data' listener
//
// Node contract (stream.Readable): attaching a 'data' listener switches the
// stream to flowing mode automatically — no explicit .resume() required.
// gjsify's ProcessReadStream previously required an explicit .resume() call,
// which silently broke MCP SDK's StdioServerTransport and similar stdin-driven
// code that relies on .on('data', …) alone.
//
// These tests verify the fix via a testable subclass that intercepts _startReading
// instead of opening a real Gio.UnixInputStream (which only exists on GJS).

import { describe, it, expect } from '@gjsify/unit';
import { ProcessReadStream } from './streams.js';

// ---------------------------------------------------------------------------
// TestableProcessReadStream — captures resume/pause calls + synthetic data
// ---------------------------------------------------------------------------

class TestableProcessReadStream extends ProcessReadStream {
    resumeCallCount = 0;
    pauseCallCount = 0;

    // Chunks queued to be emitted when reading starts
    private _pendingChunks: Uint8Array[] = [];

    constructor() {
        // Use fd -1 so the base constructor does not open a real Gio stream.
        // The base resume() guard is `this._gio && this.fd === 0 && !this._reading`;
        // with fd -1 _startReading is never called by the base class.
        super(-1);
    }

    /** Queue a synthetic chunk to be delivered synchronously on the next resume. */
    feedChunk(data: Uint8Array): void {
        this._pendingChunks.push(data);
    }

    override resume(): this {
        this.resumeCallCount++;
        super.resume();
        // Flush any synthetic chunks immediately (simulates async I/O resolving).
        // Route through `_pushData` — the same emit path the real Gio callback
        // uses — so the setEncoding/StringDecoder wiring is exercised by tests.
        while (this._pendingChunks.length > 0) {
            const chunk = this._pendingChunks.shift()!;
            this._pushData(Buffer.from(chunk));
        }
        return this;
    }

    override pause(): this {
        this.pauseCallCount++;
        return super.pause();
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export default async () => {
    await describe('ProcessReadStream: auto-resume on data listener', async () => {
        await it('attaching on("data") calls resume() automatically', async () => {
            const stream = new TestableProcessReadStream();
            expect(stream.resumeCallCount).toBe(0);

            stream.on('data', () => {});
            // Flowing-mode must have engaged — resume() should have been called once.
            expect(stream.resumeCallCount).toBe(1);
        });

        await it('addListener("data") calls resume() automatically', async () => {
            const stream = new TestableProcessReadStream();
            stream.addListener('data', () => {});
            expect(stream.resumeCallCount).toBe(1);
        });

        await it('once("data") calls resume() automatically', async () => {
            const stream = new TestableProcessReadStream();
            stream.once('data', () => {});
            expect(stream.resumeCallCount).toBe(1);
        });

        await it('data handler receives chunks without explicit resume()', async () => {
            const stream = new TestableProcessReadStream();
            const payload = new TextEncoder().encode('hello');
            stream.feedChunk(payload);

            const received: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => received.push(chunk));

            expect(received.length).toBe(1);
            expect(Buffer.from(received[0]).toString()).toBe('hello');
        });

        await it('removing last data listener calls pause()', async () => {
            const stream = new TestableProcessReadStream();
            const handler = () => {};
            stream.on('data', handler);
            expect(stream.pauseCallCount).toBe(0);

            stream.removeListener('data', handler);
            expect(stream.pauseCallCount).toBe(1);
        });

        await it('pause() not called while other data listeners remain', async () => {
            const stream = new TestableProcessReadStream();
            const h1 = () => {};
            const h2 = () => {};
            stream.on('data', h1);
            stream.on('data', h2);
            stream.removeListener('data', h1); // h2 still registered
            expect(stream.pauseCallCount).toBe(0);
            stream.removeListener('data', h2); // now empty
            expect(stream.pauseCallCount).toBe(1);
        });

        await it('off() (alias for removeListener) triggers pause when last listener removed', async () => {
            const stream = new TestableProcessReadStream();
            const handler = () => {};
            stream.on('data', handler);
            stream.off('data', handler);
            expect(stream.pauseCallCount).toBe(1);
        });

        await it('removeAllListeners() triggers pause when data listeners existed', async () => {
            const stream = new TestableProcessReadStream();
            stream.on('data', () => {});
            stream.on('data', () => {});
            stream.removeAllListeners('data');
            expect(stream.pauseCallCount).toBe(1);
        });

        await it('adding non-data listener does NOT trigger resume()', async () => {
            const stream = new TestableProcessReadStream();
            stream.on('end', () => {});
            stream.on('error', () => {});
            expect(stream.resumeCallCount).toBe(0);
        });

        await it('second data listener does NOT call resume() again', async () => {
            const stream = new TestableProcessReadStream();
            stream.on('data', () => {});
            stream.on('data', () => {});
            // resume() should only be called once (when the first 'data' listener appears)
            expect(stream.resumeCallCount).toBe(1);
        });
    });

    await describe('ProcessReadStream: setEncoding emits decoded strings (Node contract)', async () => {
        await it("setEncoding('utf-8') makes 'data' emit strings, not Buffers", async () => {
            const stream = new TestableProcessReadStream();
            stream.setEncoding('utf-8');
            stream.feedChunk(new TextEncoder().encode('hi'));
            const received: unknown[] = [];
            stream.on('data', (c: unknown) => received.push(c));
            expect(received.length).toBe(1);
            expect(typeof received[0]).toBe('string');
            expect(received[0]).toBe('hi');
        });

        await it("without setEncoding, 'data' still emits Buffers (unchanged)", async () => {
            const stream = new TestableProcessReadStream();
            stream.feedChunk(new TextEncoder().encode('hi'));
            const received: unknown[] = [];
            stream.on('data', (c: unknown) => received.push(c));
            expect(received.length).toBe(1);
            expect(typeof received[0]).not.toBe('string'); // a Buffer
            expect(Buffer.from(received[0] as Uint8Array).toString()).toBe('hi');
        });

        await it("setEncoding('utf-8') decodes a multi-byte char split across chunks", async () => {
            // 'é' = 0xC3 0xA9, fed as two separate reads. A naive per-chunk
            // toString() would mangle it; StringDecoder buffers the partial tail.
            const stream = new TestableProcessReadStream();
            stream.setEncoding('utf-8');
            stream.feedChunk(new Uint8Array([0xc3]));
            stream.feedChunk(new Uint8Array([0xa9]));
            const received: string[] = [];
            stream.on('data', (c: string) => received.push(c));
            expect(received.join('')).toBe('é');
            for (const c of received) expect(typeof c).toBe('string');
        });
    });
};
