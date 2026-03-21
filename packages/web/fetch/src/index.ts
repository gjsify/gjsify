/**
 * fetch() implementation for GJS using libsoup 3.0.
 *
 * Based on the Fetch API spec:
 * https://fetch.spec.whatwg.org/
 */

import type Gio from '@girs/gio-2.0';
import Stream from 'stream';

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

const supportedSchemas = new Set(['data:', 'http:', 'https:']);

/**
 * Fetch function
 *
 * @param url Absolute url or Request instance
 * @param init Fetch options
 */
export default async function fetch(url: RequestInfo | URL | Request, init: RequestInit = {}): Promise<Response> {
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
  } catch (error: any) {
    throw new FetchError(`request to ${request.url} failed, reason: ${error.message}`, 'system', error);
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

        const requestOptions: any = {
          headers: new Headers(request.headers),
          follow: request.follow,
          counter: request.counter + 1,
          agent: request.agent,
          compress: request.compress,
          method: request.method,
          body: clone(request),
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
        return fetch(new Request(locationURL, requestOptions as RequestInit));
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
