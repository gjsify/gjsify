// SPDX-License-Identifier: MIT
// Adapted from node-fetch (https://github.com/node-fetch/node-fetch) and the Fetch API spec (https://fetch.spec.whatwg.org/)
// Copyright (c) node-fetch contributors. MIT license.
// Modifications: Rewritten for GJS using libsoup 3.0 (Soup.Session)

import type Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Stream from 'node:stream';

import { parseDataUri } from './utils/data-uri.js';

import { writeToStream, clone } from './body.js';
import Response from './response.js';
import Headers from './headers.js';
import Request, { getSoupRequestOptions } from './request.js';
import { FetchError } from './errors/fetch-error.js';
import { AbortError } from './errors/abort-error.js';
import { isRedirect } from './utils/is-redirect.js';
import { FormData } from '@gjsify/formdata';
import { isDomainOrSubdomain, isSameProtocol } from './utils/is.js';
import { parseReferrerPolicyFromHeader } from './utils/referrer.js';
import {
  Blob,
  File,
} from './utils/blob-from.js';

import { URL } from '@gjsify/url';

export { FormData, Headers, Request, Response, FetchError, AbortError, isRedirect };
export { Blob, File };

import type { SystemError } from './types/index.js';

const supportedSchemas = new Set(['data:', 'http:', 'https:', 'file:']);

/**
 * Rewrite root-relative URLs (e.g. `/res/images/foo.png`) to `file://` relative
 * to the program directory. In a browser these would resolve against the page
 * origin; in GJS there is no origin, so we map them to the running bundle's
 * directory. This lets apps use the same asset paths across browser and GJS.
 */
/**
 * Rewrite root-relative URLs (e.g. `/res/images/foo.png`) to `file://` relative
 * to the program directory. This lets GJS apps load bundled assets using the
 * same paths as in the browser. The security implications (arbitrary file
 * reads via fetch) are acceptable for the current use cases — revisit if
 * @gjsify/fetch is ever used to handle untrusted input.
 */
function rewriteRootRelativeUrl(input: RequestInfo | URL | Request): RequestInfo | URL | Request {
  if (typeof input !== 'string') return input;
  if (!input.startsWith('/') || input.startsWith('//')) return input;
  const DEBUG = (globalThis as any).__GJSIFY_DEBUG_FETCH === true;
  try {
    // GJS-only: derive program dir from System.programInvocationName.
    const imports = (globalThis as any).imports;
    const programPath = imports?.system?.programPath
      ?? imports?.system?.programInvocationName
      ?? '';
    if (!programPath) return input;
    const dir = GLib.path_get_dirname(programPath);
    const rewritten = `file://${dir}${input}`;
    if (DEBUG) console.log(`[fetch] rewrite ${input} → ${rewritten}`);
    return rewritten;
  } catch (err) {
    if (DEBUG) console.warn(`[fetch] rewrite FAILED: ${(err as any)?.message ?? err}`);
    return input;
  }
}

/**
 * Fetch function
 *
 * @param url Absolute url or Request instance
 * @param init Fetch options
 */
export default async function fetch(url: RequestInfo | URL | Request, init: RequestInit = {}): Promise<Response> {
  // Rewrite root-relative URLs before Request constructor parses them
  url = rewriteRootRelativeUrl(url);

  // Build request object
  const request = new Request(url, init);
  const { parsedURL, options } = getSoupRequestOptions(request);
  if (!supportedSchemas.has(parsedURL.protocol)) {
    throw new TypeError(`@gjsify/fetch cannot load ${url}. URL scheme "${parsedURL.protocol.replace(/:$/, '')}" is not supported.`);
  }

  // Handle data: URIs
  if (parsedURL.protocol === 'data:') {
    const { buffer, typeFull } = parseDataUri(request.url);
    const response = new Response(Buffer.from(buffer), { headers: { 'Content-Type': typeFull } });
    return response;
  }

  // Handle file:// URIs via GLib direct read (no Soup needed).
  if (parsedURL.protocol === 'file:') {
    const DEBUG = (globalThis as any).__GJSIFY_DEBUG_FETCH === true;
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
      throw new FetchError(`request to ${request.url} failed, reason: ${err.message}`, 'system', err as unknown as SystemError);
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
    const err = error instanceof Error ? error : new Error(String(error));
    throw new FetchError(`request to ${request.url} failed, reason: ${err.message}`, 'system', err as unknown as SystemError);
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

  // Listen for cancellation
  cancellable.connect('cancelled', () => {
    readable.destroy(new AbortError('The operation was aborted.'));
  });

  // Handle stream errors
  readable.on('error', (error: SystemError) => {
    finalize();
    // Error is consumed by the body when read
  });

  const message = request._message;
  const headers = Headers._newFromSoupMessage(message);
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
        throw new FetchError(`uri requested responds with an invalid redirect URL: ${location}`, 'invalid-redirect');
      }
    }

    switch (request.redirect) {
      case 'error':
        finalize();
        throw new FetchError(`uri requested responds with a redirect, redirect mode is set to error: ${request.url}`, 'no-redirect');

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
          referrerPolicy: request.referrerPolicy
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
          throw new FetchError('Cannot follow redirect with body being a readable stream', 'unsupported-redirect');
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
    highWaterMark: request.highWaterMark
  };

  // Handle content encoding (decompression)
  const codings = headers.get('Content-Encoding');

  // Skip decompression when:
  // 1. compression support is disabled
  // 2. HEAD request
  // 3. no Content-Encoding header
  // 4. no content response (204)
  // 5. content not modified response (304)
  if (!request.compress || request.method === 'HEAD' || codings === null || statusCode === 204 || statusCode === 304) {
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
      const webBody = new Response(readable, responseOptions).body;
      if (webBody) {
        const decompressed = webBody.pipeThrough(new DecompressionStream(format) as ReadableWritablePair<Uint8Array, Uint8Array>);
        finalize();
        return new Response(decompressed as unknown as ReadableStream, responseOptions);
      }
    }
  }

  // Fallback: return the body as-is (no streaming decompression available)
  finalize();
  return new Response(readable, responseOptions);
}

// Note: globals are no longer registered at import time. Use the `/register`
// subpath (`import '@gjsify/fetch/register'`) if you need
// globalThis.fetch / Headers / Request / Response to be set on GJS.
