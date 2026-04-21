import { describe, it, expect, on } from '@gjsify/unit';

// fetch / Headers / Request / Response / FormData are accessed off globalThis:
// on Node they are native, on GJS they are installed by
// `@gjsify/fetch/register` (pulled in automatically by `--globals auto`).
// XMLHttpRequest is GJS-only and is likewise read from globalThis inside an
// on('Gjs', …) gate further below.

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

		// raw() is a node-fetch extension, not part of the standard Web API
		await on('Gjs', async () => {
			await it('should support raw() method', async () => {
				const h = new Headers();
				h.append('x-multi', 'a');
				h.append('x-multi', 'b');
				const raw = (h as any).raw();
				expect(raw['x-multi'].length).toBe(2);
				expect(raw['x-multi'][0]).toBe('a');
				expect(raw['x-multi'][1]).toBe('b');
			});
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const h = new Headers();
			expect(Object.prototype.toString.call(h)).toBe('[object Headers]');
		});
	});

	await describe('Headers forEach', async () => {
		await it('should iterate all headers with forEach', async () => {
			const h = new Headers({ 'a': '1', 'b': '2' });
			const collected: string[] = [];
			h.forEach((value, key) => { collected.push(`${key}:${value}`); });
			expect(collected.length).toBe(2);
			expect(collected[0]).toBe('a:1');
			expect(collected[1]).toBe('b:2');
		});

		await it('should return correct values() iterator', async () => {
			const h = new Headers({ 'x': 'hello', 'y': 'world' });
			const values = [...h.values()];
			expect(values.length).toBe(2);
		});

		await it('should be iterable with for...of', async () => {
			const h = new Headers({ 'content-type': 'text/plain', 'x-custom': 'val' });
			const entries: [string, string][] = [];
			for (const [k, v] of h) entries.push([k, v]);
			expect(entries.length).toBe(2);
			expect(entries[0][0]).toBe('content-type');
			expect(entries[1][0]).toBe('x-custom');
		});

		await it('should support spread operator', async () => {
			const h = new Headers({ 'a': '1' });
			const arr = [...h];
			expect(arr.length).toBe(1);
			expect(arr[0][0]).toBe('a');
			expect(arr[0][1]).toBe('1');
		});

		await it('should throw on invalid header name in set()', async () => {
			const h = new Headers();
			expect(() => h.set('invalid header', 'value')).toThrow();
		});

		await it('should throw on invalid header name in append()', async () => {
			const h = new Headers();
			expect(() => h.append('invalid header', 'value')).toThrow();
		});

		await it('should support entries() for destructuring', async () => {
			const h = new Headers({ 'host': 'example.com', 'accept': '*/*' });
			const obj: Record<string, string> = {};
			for (const [k, v] of h.entries()) obj[k] = v;
			expect(obj['accept']).toBe('*/*');
			expect(obj['host']).toBe('example.com');
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

		await it('should default redirect to "follow"', async () => {
			const r = new Request('https://example.com');
			expect(r.redirect).toBe('follow');
		});

		await it('should have a signal property', async () => {
			const r = new Request('https://example.com');
			expect(r.signal).toBeDefined();
		});

		await it('should clone a request', async () => {
			const r = new Request('https://example.com', {
				method: 'POST',
				headers: { 'X-Test': 'value' },
			});
			const clone = r.clone();
			expect(clone.url).toBe(r.url);
			expect(clone.method).toBe('POST');
			expect(clone.headers.get('x-test')).toBe('value');
		});

		await it('should create request with null body', async () => {
			const r = new Request('https://example.com', { body: null });
			expect(r.body).toBeNull();
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
			const json = await r.json() as { key: string };
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

		await it('Response.json() should create JSON response', async () => {
			const r = Response.json({ message: 'ok' });
			expect(r.status).toBe(200);
			const ct = r.headers.get('content-type') || '';
			expect(ct.includes('application/json')).toBe(true);
			const data = await r.json() as { message: string };
			expect(data.message).toBe('ok');
		});

		await it('should clone a response', async () => {
			const r = new Response('clone test');
			const c = r.clone();
			const text1 = await r.text();
			const text2 = await c.text();
			expect(text1).toBe('clone test');
			expect(text2).toBe('clone test');
		});

		await it('should have correct statusText', async () => {
			const r = new Response(null, { status: 201, statusText: 'Created' });
			expect(r.statusText).toBe('Created');
		});

		await it('should have correct type for normal response', async () => {
			const r = new Response();
			expect(r.type).toBe('default');
		});

		await it('should have correct headers property', async () => {
			const r = new Response(null, { headers: { 'X-Test': 'yes' } });
			expect(r.headers.get('x-test')).toBe('yes');
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

	await on('Gjs', async () => {
		await describe('XMLHttpRequest responseType', async () => {
			// Regression: Excalibur.js sets responseType='arraybuffer' for audio and
			// 'blob' for images. Before this fix XHR ignored responseType and always
			// returned text, which crashed gst_memory_new_wrapped on audio decode and
			// broke URL.createObjectURL on image load.
			//
			// XMLHttpRequest is accessed off globalThis (not imported). On GJS it's
			// registered by `@gjsify/fetch/register/xhr` (pulled in by --globals
			// auto when the detector sees `new XMLHttpRequest()`); on Node there
			// is no native XMLHttpRequest, so the suite is gated with on('Gjs', …).
			const XHR = (globalThis as any).XMLHttpRequest;

			const runXhr = (init: (xhr: any) => void) => new Promise<any>((resolve, reject) => {
				const xhr = new XHR();
				xhr.open('GET', 'data:text/plain;base64,aGVsbG8=');
				init(xhr);
				xhr.onload = () => resolve(xhr);
				xhr.onerror = () => reject(new Error('xhr error'));
				xhr.send();
			});

			await it('responseType="arraybuffer" yields ArrayBuffer', async () => {
				const xhr = await runXhr((x) => { x.responseType = 'arraybuffer'; });
				expect(xhr.response instanceof ArrayBuffer).toBe(true);
				expect((xhr.response as ArrayBuffer).byteLength).toBe(5);
			});

			await it('responseType="text" yields decoded string', async () => {
				const xhr = await runXhr((x) => { x.responseType = 'text'; });
				expect(xhr.response).toBe('hello');
				expect(xhr.responseText).toBe('hello');
			});

			await it('default responseType "" yields text', async () => {
				const xhr = await runXhr(() => { /* responseType left at "" */ });
				expect(xhr.response).toBe('hello');
				expect(xhr.responseText).toBe('hello');
			});

			await it('responseType="blob" attaches _tmpPath for URL.createObjectURL', async () => {
				const xhr = await runXhr((x) => { x.responseType = 'blob'; });
				const blob = xhr.response as Blob & { _tmpPath?: string };
				expect(blob instanceof Blob).toBe(true);
				expect(typeof blob._tmpPath).toBe('string');
				const url = URL.createObjectURL(blob);
				expect(url.startsWith('file://')).toBe(true);
				URL.revokeObjectURL(url);
			});
		});
	});
};
