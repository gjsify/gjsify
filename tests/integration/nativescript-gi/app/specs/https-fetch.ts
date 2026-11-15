// SPIKE S3 (android-ports roadmap, P2): does NativeScript's OWN `fetch` do what the REST clients
// of the Steuererklaerung and Curlew ports need, on a device?
//
// `@gjsify/fetch` ships `nativescript: "none"` in its runtime manifest, so on this target the
// global `fetch` is the platform's (OkHttp / HttpURLConnection on Android, which trust the OS
// certificate store by construction). That makes the question empirical rather than a
// build-the-sysroot one: which features of the standard `fetch` do the clients use that the
// platform's version drops? Engine-independent, so it runs once per leg and the two results
// must agree.
//
// NETWORK-DEPENDENT. A device without a route to the hosts below fails the first case with a
// message that says so; that is a finding about the device, not about `fetch`.
import { describe, expect, info, it } from '../reporter.js';

const VALID = 'https://example.com/';
const JSON_HOST = 'https://api.github.com/';
const SELF_SIGNED = 'https://self-signed.badssl.com/';
const EXPIRED = 'https://expired.badssl.com/';

/** What a rejected request looked like, for the report: the platform's wording is the finding. */
async function rejection(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        await response.text();
        return null;
    } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
}

export default async function httpsFetchSpec(): Promise<void> {
    await describe('NativeScript fetch on the device (spike S3)', async () => {
        await it('is a function and Response/Headers/AbortController exist', () => {
            expect(typeof fetch).toBe('function');
            expect(typeof Response).toBe('function');
            expect(typeof Headers).toBe('function');
            expect(typeof AbortController).toBe('function');
        });

        await it('GETs a valid HTTPS host and reads the body as text', async () => {
            const response = await fetch(VALID);
            expect(response.ok).toBe(true);
            expect(response.status).toBe(200);
            const text = await response.text();
            expect(text).toContain('Example Domain');
        });

        await it('reads response headers and parses JSON', async () => {
            const response = await fetch(JSON_HOST, {
                headers: { Accept: 'application/json', 'User-Agent': 'gjsify-spike' },
            });
            info(`content-type=${response.headers.get('content-type')}`);
            expect(String(response.headers.get('content-type'))).toContain('json');
            const body = (await response.json()) as { current_user_url?: string };
            expect(typeof body.current_user_url).toBe('string');
        });

        await it('reads the body as an ArrayBuffer', async () => {
            const response = await fetch(VALID);
            const bytes = new Uint8Array(await response.arrayBuffer());
            expect(bytes.length > 100).toBe(true);
        });

        await it('POSTs a JSON body', async () => {
            const response = await fetch('https://postman-echo.com/post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spike: 'S3' }),
            });
            expect(response.ok).toBe(true);
            const echoed = (await response.json()) as { json?: { spike?: string } };
            expect(echoed.json?.spike).toBe('S3');
        });

        await it('POSTs FormData: text fields travel; whether a Blob part travels as a file is reported', async () => {
            const form = new FormData();
            form.append('title', 'S3');
            form.append('document', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
            const response = await fetch('https://postman-echo.com/post', { method: 'POST', body: form });
            expect(response.ok).toBe(true);
            const echoed = (await response.json()) as { form?: { title?: string }; files?: Record<string, unknown> };
            info(`form=${JSON.stringify(echoed.form)} files=${Object.keys(echoed.files ?? {}).join(',')}`);
            expect(echoed.form?.title).toBe('S3');
            // MEASURED (emulator, API 36): the Blob part arrives as the string `[object Blob]` in `form`, never
            // as a file, so a Paperless upload cannot go through `FormData`. Reported, not asserted: the
            // next case is the supported route, and this one flips the day the platform fixes it.
            info(`blob part as file: ${Object.keys(echoed.files ?? {}).join(',') === 'hello.txt'}`);
        });

        await it('POSTs a hand-built multipart body as an ArrayBuffer (the file-upload route; a Uint8Array body is dropped)', async () => {
            const boundary = '----gjsifyS3boundary';
            const encode = (text: string) => new TextEncoder().encode(text);
            const parts = [
                encode(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nS3\r\n`),
                encode(
                    `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="hello.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n`,
                ),
                encode(`--${boundary}--\r\n`),
            ];
            const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
            let offset = 0;
            for (const part of parts) {
                body.set(part, offset);
                offset += part.length;
            }
            const response = await fetch('https://postman-echo.com/post', {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body: body.buffer as ArrayBuffer,
            });
            const echoed = (await response.json()) as { form?: { title?: string }; files?: Record<string, unknown> };
            info(`bytes: form=${JSON.stringify(echoed.form)} files=${Object.keys(echoed.files ?? {}).join(',')}`);
            expect(Object.keys(echoed.files ?? {}).join(',')).toBe('hello.txt');
        });

        await it('an HTTP error status resolves with ok=false and does not throw', async () => {
            const response = await fetch('https://postman-echo.com/status/404');
            expect(response.ok).toBe(false);
            expect(response.status).toBe(404);
        });

        await it('an AbortSignal that is already aborted rejects the request', async () => {
            const controller = new AbortController();
            controller.abort();
            let rejected = false;
            try {
                await fetch(VALID, { signal: controller.signal });
            } catch {
                rejected = true;
            }
            expect(rejected).toBe(true);
        });

        await it('an AbortSignal fired mid-flight rejects the request', async () => {
            const controller = new AbortController();
            const pending = fetch('https://postman-echo.com/delay/3', { signal: controller.signal });
            setTimeout(() => controller.abort(), 200);
            let rejected = false;
            try {
                await pending;
            } catch {
                rejected = true;
            }
            expect(rejected).toBe(true);
        });

        await it('REJECTS a self-signed certificate', async () => {
            const reason = await rejection(SELF_SIGNED);
            info(`self-signed: ${reason}`);
            expect(reason === null).toBe(false);
        });

        await it('REJECTS an expired certificate', async () => {
            const reason = await rejection(EXPIRED);
            info(`expired: ${reason}`);
            expect(reason === null).toBe(false);
        });
    });
}
