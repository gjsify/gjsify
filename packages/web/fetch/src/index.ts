// SPDX-License-Identifier: MIT
// Adapted from node-fetch (https://github.com/node-fetch/node-fetch) and the Fetch API spec (https://fetch.spec.whatwg.org/)
// Copyright (c) node-fetch contributors. MIT license.
// Modifications: Rewritten for GJS using libsoup 3.0 (Soup.Session)

import type Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Stream from 'node:stream';

import { parseDataUri } from './utils/data-uri.js';
import { resolveRootRelativeUrl } from './utils/root-relative-system.js';

import { clone } from './body.js';
import Response from './response.js';
import Headers from './headers.js';
import Request, { getSoupRequestOptions } from './request.js';
import { loadSoup } from './utils/soup-lazy.js';
import { FetchError } from './errors/fetch-error.js';
import { AbortError } from './errors/abort-error.js';
import { isRedirect } from './utils/is-redirect.js';
import { FormData } from '@gjsify/formdata';
import { isDomainOrSubdomain, isSameProtocol } from './utils/is.js';
import { parseReferrerPolicyFromHeader } from './utils/referrer.js';
import { Blob, File } from './utils/blob-from.js';

import { URL } from '@gjsify/url';

export { FormData, Headers, Request, Response, FetchError, AbortError, isRedirect };
export { Blob, File };
export { XMLHttpRequest, XMLHttpRequestUpload } from './xhr.js';
// The shared program-dir rewrite — consumed by @gjsify/xmlhttprequest so fetch
// and XHR cannot drift apart again (see utils/root-relative.ts for the pure
// logic + utils/root-relative-system.ts for the `system`-reading wrapper).
export { resolveRootRelativeUrl } from './utils/root-relative-system.js';

import type { SystemError } from './types/index.js';

const supportedSchemas = new Set(['data:', 'http:', 'https:', 'file:']);

/** Module-local typed view of the debug flag this file reads. */
interface _FetchRuntimeGlobals {
    __GJSIFY_DEBUG_FETCH?: boolean;
}

/**
 * String inputs go through the shared root-relative rewrite
 * (`utils/root-relative.ts` — one copy for fetch AND XHR; two drifting copies
 * are what #869 was). Non-string inputs pass through untouched.
 */
function rewriteFetchInput(input: RequestInfo | URL | Request): RequestInfo | URL | Request {
    if (typeof input !== 'string') return input;
    // No try/catch: `resolveRootRelativeUrl` reads two properties off the
    // `system` built-in and calls a pure function — there is no throw path, so
    // a catch here could only ever SWALLOW a bug. That is precisely how #869
    // hid: the previous spelling reached `globalThis.imports.system`, which is
    // `undefined` off gjs, and the catch turned the resulting TypeError into a
    // silently unrewritten URL. If this ever does throw, the caller should see
    // it.
    const rewritten = resolveRootRelativeUrl(input);
    if (rewritten !== input && (globalThis as unknown as _FetchRuntimeGlobals).__GJSIFY_DEBUG_FETCH === true) {
        console.log(`[fetch] rewrite ${input} → ${rewritten}`);
    }
    return rewritten;
}

/**
 * Fetch function
 *
 * @param url Absolute url or Request instance
 * @param init Fetch options
 */
export default async function fetch(url: RequestInfo | URL | Request, init: RequestInit = {}): Promise<Response> {
    // Rewrite root-relative URLs before Request constructor parses them
    url = rewriteFetchInput(url);

    // Build request object
    const request = new Request(url, init);
    const { parsedURL, options } = getSoupRequestOptions(request);
    if (!supportedSchemas.has(parsedURL.protocol)) {
        throw new TypeError(
            `@gjsify/fetch cannot load ${url}. URL scheme "${parsedURL.protocol.replace(/:$/, '')}" is not supported.`,
        );
    }

    // Handle data: URIs
    if (parsedURL.protocol === 'data:') {
        const { buffer, typeFull } = parseDataUri(request.url);
        const response = new Response(Buffer.from(buffer), { headers: { 'Content-Type': typeFull } });
        return response;
    }

    // Handle file:// URIs via GLib direct read (no Soup needed).
    if (parsedURL.protocol === 'file:') {
        const DEBUG = (globalThis as unknown as _FetchRuntimeGlobals).__GJSIFY_DEBUG_FETCH === true;
        if (DEBUG) console.log(`[fetch] file:// ${request.url}`);
        try {
            const path = GLib.filename_from_uri(request.url)[0];
            if (DEBUG) console.log(`[fetch] file:// path=${path}`);
            const [ok, contents] = GLib.file_get_contents(path);
            if (DEBUG) console.log(`[fetch] file:// ok=${ok} bytes=${contents?.byteLength ?? '?'}`);
            if (!ok) {
                throw new FetchError(`Failed to read file: ${path}`, 'system');
            }
            const bytes = contents as Uint8Array;
            // Copy to a fresh Uint8Array backed by its own ArrayBuffer so the
            // Response body owns the memory independently of GLib's buffer.
            const body = new Uint8Array(bytes.byteLength);
            body.set(bytes);
            const resp = new Response(body);
            if (DEBUG) console.log(`[fetch] file:// response created`);
            return resp;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            if (DEBUG) console.warn(`[fetch] file:// FAIL: ${err.message}`);
            throw new FetchError(
                `request to ${request.url} failed, reason: ${err.message}`,
                'system',
                err as unknown as SystemError,
            );
        }
    }

    const { signal } = request;

    // Check if already aborted
    if (signal && signal.aborted) {
        throw new AbortError('The operation was aborted.');
    }

    // Send HTTP request via Soup
    let readable: Stream.Readable;
    let cancellable: Gio.Cancellable;

    try {
        const sendRes = await request._send(options);
        readable = sendRes.readable;
        cancellable = sendRes.cancellable;
    } catch (error: unknown) {
        // A send aborted during connect/handshake/TTFB surfaces as a cancelled send_async — report it
        // as an AbortError (Node parity), not a generic system FetchError.
        if (signal && signal.aborted) {
            throw new AbortError('The operation was aborted.');
        }
        const err = error instanceof Error ? error : new Error(String(error));
        throw new FetchError(
            `request to ${request.url} failed, reason: ${err.message}`,
            'system',
            err as unknown as SystemError,
        );
    }

    // Wire up abort signal to cancellable
    const abortHandler = () => {
        cancellable.cancel();
    };

    if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
    }

    const finalize = () => {
        if (signal) {
            signal.removeEventListener('abort', abortHandler);
        }
    };

    // Listen for cancellation.
    // Gio.Cancellable.connect() is g_cancellable_connect() — pass callback + DestroyNotify (or null).
    // NOT a GObject signal: do NOT pass a signal name as the first argument.
    cancellable.connect(() => {
        readable.destroy(new AbortError('The operation was aborted.'));
    });

    // Handle stream errors
    readable.on('error', (_error: SystemError) => {
        finalize();
        // Error is consumed by the body when read
    });

    const message = request._message;
    // Soup is already linked+cached by request._send above; loadSoup() returns
    // the cached namespace so _newFromSoupMessage stays synchronous over it.
    const soup = await loadSoup();
    const headers = Headers._newFromSoupMessage(soup, message);
    const statusCode = message.status_code;
    const statusMessage = message.get_reason_phrase();

    // HTTP fetch step 5 — handle redirects
    if (isRedirect(statusCode)) {
        const location = headers.get('Location');

        let locationURL: URL | null = null;
        try {
            locationURL = location === null ? null : new URL(location, request.url);
        } catch {
            if (request.redirect !== 'manual') {
                finalize();
                throw new FetchError(
                    `uri requested responds with an invalid redirect URL: ${location}`,
                    'invalid-redirect',
                );
            }
        }

        switch (request.redirect) {
            case 'error':
                finalize();
                throw new FetchError(
                    `uri requested responds with a redirect, redirect mode is set to error: ${request.url}`,
                    'no-redirect',
                );

            case 'manual':
                // Nothing to do — return opaque redirect response
                break;

            case 'follow': {
                if (locationURL === null) {
                    break;
                }

                if (request.counter >= request.follow) {
                    finalize();
                    throw new FetchError(`maximum redirect reached at: ${request.url}`, 'max-redirect');
                }

                const requestOptions: Omit<RequestInit, 'headers'> & {
                    headers: Headers;
                    follow: number;
                    counter: number;
                    agent: string | ((url: URL) => string);
                    compress: boolean;
                    size: number;
                } = {
                    headers: new Headers(request.headers),
                    follow: request.follow,
                    counter: request.counter + 1,
                    agent: request.agent,
                    compress: request.compress,
                    method: request.method,
                    body: clone(request) as unknown as BodyInit | null,
                    signal: request.signal,
                    size: request.size,
                    referrer: request.referrer,
                    referrerPolicy: request.referrerPolicy,
                };

                // Don't forward sensitive headers to different domains/protocols
                if (!isDomainOrSubdomain(request.url, locationURL) || !isSameProtocol(request.url, locationURL)) {
                    for (const name of ['authorization', 'www-authenticate', 'cookie', 'cookie2']) {
                        requestOptions.headers.delete(name);
                    }
                }

                // Cannot follow redirect with body being a readable stream
                if (statusCode !== 303 && request.body && init.body instanceof Stream.Readable) {
                    finalize();
                    throw new FetchError(
                        'Cannot follow redirect with body being a readable stream',
                        'unsupported-redirect',
                    );
                }

                // 303 or POST→GET conversion
                if (statusCode === 303 || ((statusCode === 301 || statusCode === 302) && request.method === 'POST')) {
                    requestOptions.method = 'GET';
                    requestOptions.body = undefined;
                    requestOptions.headers.delete('content-length');
                }

                // Update referrer policy from response
                const responseReferrerPolicy = parseReferrerPolicyFromHeader(headers);
                if (responseReferrerPolicy) {
                    requestOptions.referrerPolicy = responseReferrerPolicy;
                }

                finalize();
                return fetch(new Request(locationURL, requestOptions as unknown as RequestInit));
            }

            default:
                throw new TypeError(`Redirect option '${request.redirect}' is not a valid value of RequestRedirect`);
        }
    }

    // Build response
    const responseOptions = {
        url: request.url,
        status: statusCode,
        statusText: statusMessage,
        headers,
        size: request.size,
        counter: request.counter,
        highWaterMark: request.highWaterMark,
    };

    // Handle content encoding (decompression)
    const codings = headers.get('Content-Encoding');

    // Skip decompression when:
    // 1. compression support is disabled
    // 2. HEAD request
    // 3. no Content-Encoding header
    // 4. no content response (204)
    // 5. content not modified response (304)
    if (
        !request.compress ||
        request.method === 'HEAD' ||
        codings === null ||
        statusCode === 204 ||
        statusCode === 304
    ) {
        finalize();
        return new Response(readable, responseOptions);
    }

    // Try to use DecompressionStream Web API (available in modern SpiderMonkey)
    if (typeof DecompressionStream !== 'undefined') {
        let format: CompressionFormat | null = null;

        if (codings === 'gzip' || codings === 'x-gzip') {
            format = 'gzip';
        } else if (codings === 'deflate' || codings === 'x-deflate') {
            format = 'deflate';
        }

        if (format) {
            // Buffer the full compressed body before decompressing.
            // Streaming pipeThrough(DecompressionStream) directly from the Soup
            // body ReadableStream trips Gio.IOErrorEnum: G_IO_ERROR_PARTIAL_INPUT
            // when libsoup closes the connection at a non-chunk boundary (observed
            // on npm-CDN gzip responses). The full body is received intact — only
            // the streaming decode is fragile. Buffer first, then decompress the
            // complete in-memory blob — the same pattern @gjsify/tar uses for .tgz.
            const rawBuffer = await new Response(readable, responseOptions).arrayBuffer();
            const decompressed = new Blob([rawBuffer])
                .stream()
                .pipeThrough(new DecompressionStream(format) as ReadableWritablePair<Uint8Array, Uint8Array>);
            finalize();
            return new Response(decompressed as unknown as ReadableStream, responseOptions);
        }
    }

    // Fallback: return the body as-is (no streaming decompression available)
    finalize();
    return new Response(readable, responseOptions);
}

// Note: globals are no longer registered at import time. Use the `/register`
// subpath (`import '@gjsify/fetch/register'`) if you need
// globalThis.fetch / Headers / Request / Response to be set on GJS.
