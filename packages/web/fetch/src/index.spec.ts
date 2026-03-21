import { describe, it, expect } from '@gjsify/unit';

import fetch, { Headers, Request, Response, FormData } from './index.ts';

export default async () => {

	await describe('fetch', async () => {
		await it('fetch should be a function', async () => {
			expect(typeof fetch).toBe("function");
		});
	});

	await describe('Headers', async () => {
		await it('should create empty headers', async () => {
			const h = new Headers();
			expect([...h.entries()].length).toBe(0);
		});

		await it('should set and get headers', async () => {
			const h = new Headers();
			h.set('Content-Type', 'text/plain');
			expect(h.get('content-type')).toBe('text/plain');
		});

		await it('should be case-insensitive', async () => {
			const h = new Headers({ 'X-Custom': 'value' });
			expect(h.get('x-custom')).toBe('value');
			expect(h.has('X-CUSTOM')).toBe(true);
		});

		await it('should append multiple values', async () => {
			const h = new Headers();
			h.append('Set-Cookie', 'a=1');
			h.append('Set-Cookie', 'b=2');
			expect(h.get('set-cookie')).toBe('a=1, b=2');
		});

		await it('should delete headers', async () => {
			const h = new Headers({ 'X-Remove': 'yes' });
			h.delete('x-remove');
			expect(h.has('x-remove')).toBe(false);
		});

		await it('should construct from array pairs', async () => {
			const h = new Headers([['a', '1'], ['b', '2']]);
			expect(h.get('a')).toBe('1');
			expect(h.get('b')).toBe('2');
		});

		await it('should construct from another Headers', async () => {
			const h1 = new Headers({ 'x-foo': 'bar' });
			const h2 = new Headers(h1);
			expect(h2.get('x-foo')).toBe('bar');
		});

		await it('should iterate entries in sorted order', async () => {
			const h = new Headers({ 'z-header': '1', 'a-header': '2' });
			const keys = [...h.keys()];
			expect(keys[0]).toBe('a-header');
			expect(keys[1]).toBe('z-header');
		});

		await it('should support raw() method', async () => {
			const h = new Headers();
			h.append('x-multi', 'a');
			h.append('x-multi', 'b');
			const raw = h.raw();
			expect(raw['x-multi'].length).toBe(2);
			expect(raw['x-multi'][0]).toBe('a');
			expect(raw['x-multi'][1]).toBe('b');
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const h = new Headers();
			expect(Object.prototype.toString.call(h)).toBe('[object Headers]');
		});
	});

	await describe('Request', async () => {
		await it('should create a request with URL string', async () => {
			const r = new Request('https://example.com');
			expect(r.url).toBe('https://example.com/');
			expect(r.method).toBe('GET');
		});

		await it('should normalize method to uppercase', async () => {
			const r = new Request('https://example.com', { method: 'post' });
			expect(r.method).toBe('POST');
		});

		await it('should set custom headers', async () => {
			const r = new Request('https://example.com', {
				headers: { 'X-Custom': 'test' }
			});
			expect(r.headers.get('x-custom')).toBe('test');
		});
	});

	await describe('Response', async () => {
		await it('should create a response with defaults', async () => {
			const r = new Response();
			expect(r.status).toBe(200);
			expect(r.ok).toBe(true);
		});

		await it('should create a response with custom status', async () => {
			const r = new Response(null, { status: 404 });
			expect(r.status).toBe(404);
			expect(r.ok).toBe(false);
		});

		await it('should parse text body', async () => {
			const r = new Response('hello world');
			const text = await r.text();
			expect(text).toBe('hello world');
		});

		await it('should parse json body', async () => {
			const r = new Response('{"key": "value"}');
			const json = await r.json();
			expect(json.key).toBe('value');
		});

		await it('should parse arrayBuffer body', async () => {
			const r = new Response('test');
			const ab = await r.arrayBuffer();
			expect(ab.byteLength).toBe(4);
		});

		await it('should track bodyUsed', async () => {
			const r = new Response('data');
			expect(r.bodyUsed).toBe(false);
			await r.text();
			expect(r.bodyUsed).toBe(true);
		});

		await it('Response.error() should return error response', async () => {
			const r = Response.error();
			expect(r.type).toBe('error');
			expect(r.status).toBe(0);
		});

		await it('Response.redirect() should create redirect', async () => {
			const r = Response.redirect('https://example.com', 301);
			expect(r.status).toBe(301);
			expect(r.headers.get('location')).toBe('https://example.com/');
		});
	});

	await describe('data: URI', async () => {
		await it('should fetch a data: URI with text', async () => {
			const r = await fetch('data:text/plain,hello%20world');
			expect(r.status).toBe(200);
			const text = await r.text();
			expect(text).toBe('hello world');
		});

		await it('should fetch a base64 data: URI', async () => {
			const r = await fetch('data:text/plain;base64,aGVsbG8=');
			const text = await r.text();
			expect(text).toBe('hello');
		});
	});
};
