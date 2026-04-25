import { run, describe, it, expect } from '@gjsify/unit';

run({
    async StreamsTest() {
        await describe('ReadableStream', async () => {
            await it('reads enqueued chunks', async () => {
                const rs = new ReadableStream({
                    start(ctrl) { ctrl.enqueue('a'); ctrl.enqueue('b'); ctrl.close(); },
                });
                const reader = rs.getReader();
                expect((await reader.read()).value).toBe('a');
                expect((await reader.read()).value).toBe('b');
                expect((await reader.read()).done).toBe(true);
            });

            await it('supports async iteration', async () => {
                const rs = new ReadableStream({
                    start(ctrl) { ctrl.enqueue(1); ctrl.enqueue(2); ctrl.close(); },
                });
                const values: number[] = [];
                for await (const v of rs) values.push(v);
                expect(values).toStrictEqual([1, 2]);
            });

            await it('tee() creates two independent streams', async () => {
                const rs = new ReadableStream({
                    start(ctrl) { ctrl.enqueue('x'); ctrl.close(); },
                });
                const [a, b] = rs.tee();
                expect((await a.getReader().read()).value).toBe('x');
                expect((await b.getReader().read()).value).toBe('x');
            });

            await it('pipeTo() transfers all chunks', async () => {
                const received: number[] = [];
                const rs = new ReadableStream({
                    start(ctrl) { ctrl.enqueue(1); ctrl.enqueue(2); ctrl.close(); },
                });
                const ws = new WritableStream({ write(c) { received.push(c); } });
                await rs.pipeTo(ws);
                expect(received).toStrictEqual([1, 2]);
            });
        });

        await describe('WritableStream', async () => {
            await it('writes chunks in order', async () => {
                const written: string[] = [];
                const ws = new WritableStream({ write(chunk) { written.push(chunk); } });
                const writer = ws.getWriter();
                await writer.write('a');
                await writer.write('b');
                await writer.close();
                expect(written).toStrictEqual(['a', 'b']);
            });

            await it('abort() rejects pending writes', async () => {
                const ws = new WritableStream();
                const writer = ws.getWriter();
                writer.abort(new Error('aborted'));
                let threw = false;
                try { await writer.write('x'); } catch (_) { threw = true; }
                expect(threw).toBe(true);
            });
        });

        await describe('TransformStream', async () => {
            await it('transforms chunks', async () => {
                const ts = new TransformStream<string, string>({
                    transform(chunk, ctrl) { ctrl.enqueue(chunk.toUpperCase()); },
                });
                const writer = ts.writable.getWriter();
                writer.write('hello');
                writer.close();
                expect(await new Response(ts.readable).text()).toBe('HELLO');
            });

            await it('passthrough when no transform defined', async () => {
                const ts = new TransformStream<string, string>();
                const writer = ts.writable.getWriter();
                writer.write('pass');
                writer.close();
                expect(await new Response(ts.readable).text()).toBe('pass');
            });
        });

        await describe('TextEncoderStream / TextDecoderStream', async () => {
            await it('round-trips UTF-8 text', async () => {
                const enc = new TextEncoderStream();
                const dec = new TextDecoderStream();
                enc.readable.pipeTo(dec.writable);
                const writer = enc.writable.getWriter();
                writer.write('héllo wörld');
                writer.close();
                expect(await new Response(dec.readable).text()).toBe('héllo wörld');
            });
        });

        await describe('ByteLengthQueuingStrategy', async () => {
            await it('size() returns byteLength', async () => {
                const s = new ByteLengthQueuingStrategy({ highWaterMark: 1024 });
                expect(s.highWaterMark).toBe(1024);
                expect(s.size(new Uint8Array(16))).toBe(16);
            });
        });

        await describe('CountQueuingStrategy', async () => {
            await it('size() always returns 1', async () => {
                const s = new CountQueuingStrategy({ highWaterMark: 4 });
                expect(s.highWaterMark).toBe(4);
                expect(s.size()).toBe(1);
            });
        });
    },
});
