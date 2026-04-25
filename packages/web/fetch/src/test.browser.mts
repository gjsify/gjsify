import { run, describe, it, expect } from '@gjsify/unit';

run({
    async FetchTest() {
        await describe('Headers', async () => {
            await it('creates empty headers', async () => {
                const h = new Headers();
                expect(h.get('content-type')).toBeNull();
            });

            await it('gets/sets headers case-insensitively', async () => {
                const h = new Headers({ 'Content-Type': 'text/plain' });
                expect(h.get('content-type')).toBe('text/plain');
                expect(h.get('CONTENT-TYPE')).toBe('text/plain');
            });

            await it('append combines values with comma', async () => {
                const h = new Headers();
                h.append('x-custom', 'a');
                h.append('x-custom', 'b');
                expect(h.get('x-custom')).toBe('a, b');
            });

            await it('delete removes a header', async () => {
                const h = new Headers({ 'x-token': 'abc' });
                h.delete('x-token');
                expect(h.get('x-token')).toBeNull();
            });

            await it('has() checks existence', async () => {
                const h = new Headers({ 'x-foo': 'bar' });
                expect(h.has('x-foo')).toBe(true);
                expect(h.has('x-missing')).toBe(false);
            });
        });

        await describe('Request', async () => {
            await it('constructs with URL string', async () => {
                const r = new Request('https://example.com');
                expect(r.url).toBe('https://example.com/');
                expect(r.method).toBe('GET');
            });

            await it('method is uppercased', async () => {
                const r = new Request('https://example.com', { method: 'post' });
                expect(r.method).toBe('POST');
            });

            await it('constructs with custom headers', async () => {
                const r = new Request('https://example.com', {
                    headers: { 'content-type': 'application/json' },
                    method: 'POST',
                    body: '{}',
                });
                expect(r.headers.get('content-type')).toBe('application/json');
            });

            await it('clone() preserves url and method', async () => {
                const r = new Request('https://example.com', { method: 'DELETE' });
                const c = r.clone();
                expect(c.url).toBe(r.url);
                expect(c.method).toBe('DELETE');
            });

            await it('has signal property', async () => {
                const r = new Request('https://example.com');
                expect(r.signal).toBeDefined();
                expect(r.signal.aborted).toBe(false);
            });
        });

        await describe('Response', async () => {
            await it('constructs with status', async () => {
                const r = new Response('body', { status: 201 });
                expect(r.status).toBe(201);
                expect(r.ok).toBe(true);
            });

            await it('ok is false for error status', async () => {
                const r = new Response('', { status: 404 });
                expect(r.ok).toBe(false);
            });

            await it('reads text body', async () => {
                const r = new Response('hello world');
                expect(await r.text()).toBe('hello world');
            });

            await it('reads json body', async () => {
                const r = new Response('{"x":42}');
                expect(await r.json()).toStrictEqual({ x: 42 });
            });

            await it('reads arrayBuffer body', async () => {
                const r = new Response(new Uint8Array([1, 2, 3]));
                const buf = await r.arrayBuffer();
                expect(buf.byteLength).toBe(3);
                expect(new Uint8Array(buf)[0]).toBe(1);
            });

            await it('bodyUsed prevents double-read', async () => {
                const r = new Response('data');
                expect(r.bodyUsed).toBe(false);
                await r.text();
                expect(r.bodyUsed).toBe(true);
            });

            await it('Response.error() returns type=error', async () => {
                const r = Response.error();
                expect(r.ok).toBe(false);
                expect(r.status).toBe(0);
            });
        });

        await describe('fetch', async () => {
            await it('fetches a local static file', async () => {
                const r = await fetch('/tests/browser/harness/index.html');
                expect(r.ok).toBe(true);
                const text = await r.text();
                expect(text).toContain('<!DOCTYPE html>');
            });

            await it('returns 404 for missing file', async () => {
                const r = await fetch('/tests/browser/__nonexistent__.html');
                expect(r.ok).toBe(false);
                expect(r.status).toBe(404);
            });
        });
    },
});
