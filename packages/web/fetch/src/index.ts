import Soup from 'gi://Soup?version=3.0';
import Gio from 'gi://Gio?version=2.0';
import Request from './request.js';

/**
 * Index.js
 *
 * a request API compatible with window.fetch
 *
 * All spec algorithm step numbers are based on https://fetch.spec.whatwg.org/commit-snapshots/ae716822cb3a61843226cd090eefc6589446c1d2/.
 */

import zlib from 'zlib';
import Stream, { PassThrough, pipeline as pump } from 'stream';

import dataUriToBuffer from 'data-uri-to-buffer';

import { writeToStream, clone } from './body.js';
import Response from './response.js';
import Headers from './headers.js';
import { getSoupRequestOptions } from './request.js';
import { FetchError } from './errors/fetch-error.js';
import { AbortError } from './errors/abort-error.js';
import { isRedirect } from './utils/is-redirect.js';
import { FormData } from 'formdata-polyfill/esm.min.js';
import { isDomainOrSubdomain, isSameProtocol } from './utils/is.js';
import { parseReferrerPolicyFromHeader } from './utils/referrer.js';
import {
  Blob,
  File,
  fileFromSync,
  fileFrom,
  blobFromSync,
  blobFrom
} from './utils/blob-from.js';

import { URL } from '@gjsify/deno-runtime/ext/url/00_url';

export { FormData, Headers, Request, Response, FetchError, AbortError, isRedirect };
export { Blob, File, fileFromSync, fileFrom, blobFromSync, blobFrom };

import type { SystemError } from './types/index.js';

const supportedSchemas = new Set(['data:', 'http:', 'https:']);

/**
 * Fetch function
 *
 * @param url Absolute url or Request instance
 * @param init Fetch options
 */
export default async function fetch(url: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return new Promise(async (resolve, reject) => {
    // Build request object
    const request = new Request(url, init);
    const { parsedURL, options } = getSoupRequestOptions(request);
    if (!supportedSchemas.has(parsedURL.protocol)) {
      throw new TypeError(`@gjsify/fetch cannot load ${url}. URL scheme "${parsedURL.protocol.replace(/:$/, '')}" is not supported.`);
    }

    if (parsedURL.protocol === 'data:') {
      const data = dataUriToBuffer(request.url);
      const response = new Response(data, { headers: { 'Content-Type': data.typeFull } });
      resolve(response);
      return;
    }

    const { signal } = request;
    let response = null;

    const abort = () => {
      const error = new AbortError('The operation was aborted.');
      reject(error);
      if (request.body && request.body instanceof Stream.Readable) {
        request.body.destroy(error);
      }

      if (!response || !response.body) {
        return;
      }

      response.body.emit('error', error);
    };

    if (signal && signal.aborted) {
      abort();
      return;
    }

    const abortAndFinalize = () => {
      abort();
      finalize();
    };

    let readable: Stream.Readable;
    let cancellable: Gio.Cancellable;

    // Send request
    try {
      const sendRes = await request._send(options);
      readable = sendRes.readable;
      cancellable = sendRes.cancellable;
    } catch (error) {
      reject(error);
    }

    if (signal) {
      signal.addEventListener('abort', abortAndFinalize);
    }

    const cancelledSignalId = cancellable.connect('cancelled', () => {
      abortAndFinalize();
    });

    const finalize = () => {
      cancellable.cancel()
      if (signal) {
        signal.removeEventListener('abort', abortAndFinalize);
      }
      cancellable.disconnect(cancelledSignalId);
    };

    const message = request._message;

    readable.on('error', (error: SystemError) => {
      reject(new FetchError(`request to ${request.url} failed, reason: ${error.message}`, 'system', error));
      finalize();
    });

    message.connect('finished', (message) => {

      const headers = Headers._newFromSoupMessage( request._message, Soup.MessageHeadersType.RESPONSE);
      const statusCode = message.status_code;
      const statusMessage = message.get_reason_phrase() ;

      // HTTP fetch step 5
      if (isRedirect(statusCode)) {
        // HTTP fetch step 5.2
        const location = headers.get('Location');

        // HTTP fetch step 5.3
        let locationURL = null;
        try {
          locationURL = location === null ? null : new URL(location, request.url);
        } catch {
          // error here can only be invalid URL in Location: header
          // do not throw when options.redirect == manual
          // let the user extract the errorneous redirect URL
          if (request.redirect !== 'manual') {
            reject(new FetchError(`uri requested responds with an invalid redirect URL: ${location}`, 'invalid-redirect'));
            finalize();
            return;
          }
        }

        // HTTP fetch step 5.5
        switch (request.redirect) {
          case 'error':
            reject(new FetchError(`uri requested responds with a redirect, redirect mode is set to error: ${request.url}`, 'no-redirect'));
            finalize();
            return;
          case 'manual':
            // Nothing to do
            break;
          case 'follow': {
            // HTTP-redirect fetch step 2
            if (locationURL === null) {
              break;
            }

            // HTTP-redirect fetch step 5
            if (request.counter >= request.follow) {
              reject(new FetchError(`maximum redirect reached at: ${request.url}`, 'max-redirect'));
              finalize();
              return;
            }

            // HTTP-redirect fetch step 6 (counter increment)
            // Create a new Request object.
            const requestOptions = {
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

            // when forwarding sensitive headers like "Authorization",
            // "WWW-Authenticate", and "Cookie" to untrusted targets,
            // headers will be ignored when following a redirect to a domain
            // that is not a subdomain match or exact match of the initial domain.
            // For example, a redirect from "foo.com" to either "foo.com" or "sub.foo.com"
            // will forward the sensitive headers, but a redirect to "bar.com" will not.
            // headers will also be ignored when following a redirect to a domain using
            // a different protocol. For example, a redirect from "https://foo.com" to "http://foo.com"
            // will not forward the sensitive headers
            if (!isDomainOrSubdomain(request.url, locationURL) || !isSameProtocol(request.url, locationURL)) {
              for (const name of ['authorization', 'www-authenticate', 'cookie', 'cookie2']) {
                requestOptions.headers.delete(name);
              }
            }

            // HTTP-redirect fetch step 9
            if (statusCode !== 303 && request.body && init.body instanceof Stream.Readable) {
              reject(new FetchError('Cannot follow redirect with body being a readable stream', 'unsupported-redirect'));
              finalize();
              return;
            }

            // HTTP-redirect fetch step 11
            if (statusCode === 303 || ((statusCode === 301 || statusCode === 302) && request.method === 'POST')) {
              requestOptions.method = 'GET';
              requestOptions.body = undefined;
              requestOptions.headers.delete('content-length');
            }

            // HTTP-redirect fetch step 14
            const responseReferrerPolicy = parseReferrerPolicyFromHeader(headers);
            if (responseReferrerPolicy) {
              requestOptions.referrerPolicy = responseReferrerPolicy;
            }

            // HTTP-redirect fetch step 15
            resolve(fetch(new Request(locationURL, requestOptions)));
            finalize();
            return;
          }

          default:
            return reject(new TypeError(`Redirect option '${request.redirect}' is not a valid value of RequestRedirect`));
        }
      }

      // Prepare response
      // if (signal) {
      //   response_.once('end', () => {
      //     signal.removeEventListener('abort', abortAndFinalize);
      //   });
      // }

      let body = pump(response_, new PassThrough(), error => {
        if (error) {
          reject(error);
        }
      });
      // see https://github.com/nodejs/node/pull/29376
      /* c8 ignore next 3 */
      // if (process.version < 'v12.10') {
      //   response_.on('aborted', abortAndFinalize);
      // }

      const responseOptions = {
        url: request.url,
        status: statusCode,
        statusText: statusMessage,
        headers,
        size: request.size,
        counter: request.counter,
        highWaterMark: request.highWaterMark
      };

      // HTTP-network fetch step 12.1.1.3
      const codings = headers.get('Content-Encoding');

      // HTTP-network fetch step 12.1.1.4: handle content codings

      // in following scenarios we ignore compression support
      // 1. compression support is disabled
      // 2. HEAD request
      // 3. no Content-Encoding header
      // 4. no content response (204)
      // 5. content not modified response (304)
      if (!request.compress || request.method === 'HEAD' || codings === null || statusCode === 204 || statusCode === 304) {
        response = new Response(body, responseOptions);
        resolve(response);
        return;
      }

      // For Node v6+
      // Be less strict when decoding compressed responses, since sometimes
      // servers send slightly invalid responses that are still accepted
      // by common browsers.
      // Always using Z_SYNC_FLUSH is what cURL does.
      const zlibOptions = {
        flush: zlib.Z_SYNC_FLUSH,
        finishFlush: zlib.Z_SYNC_FLUSH
      };

      // For gzip
      if (codings === 'gzip' || codings === 'x-gzip') {
        body = pump(body, zlib.createGunzip(zlibOptions), error => {
          if (error) {
            reject(error);
          }
        });
        response = new Response(body, responseOptions);
        resolve(response);
        return;
      }

      // For deflate
      // if (codings === 'deflate' || codings === 'x-deflate') {
      //   // Handle the infamous raw deflate response from old servers
      //   // a hack for old IIS and Apache servers
      //   const raw = pump(response_, new PassThrough(), error => {
      //     if (error) {
      //       reject(error);
      //     }
      //   });
      
      //   raw.once('data', chunk => {
      //     // See http://stackoverflow.com/questions/37519828
      //     if ((chunk[0] & 0x0F) === 0x08) {
      //       body = pump(body, zlib.createInflate(), error => {
      //         if (error) {
      //           reject(error);
      //         }
      //       });
      //     } else {
      //       body = pump(body, zlib.createInflateRaw(), error => {
      //         if (error) {
      //           reject(error);
      //         }
      //       });
      //     }

      //     response = new Response(body, responseOptions);
      //     resolve(response);
      //   });

      //   raw.once('end', () => {
      //     // Some old IIS servers return zero-length OK deflate responses, so
      //     // 'data' is never emitted. See https://github.com/node-fetch/node-fetch/pull/903
      //     if (!response) {
      //       response = new Response(body, responseOptions);
      //       resolve(response);
      //     }
      //   });
      //   return;
      // }

      // For br
      if (codings === 'br') {
        body = pump(body, zlib.createBrotliDecompress(), error => {
          if (error) {
            reject(error);
          }
        });
        response = new Response(body, responseOptions);
        resolve(response);
        return;
      }

      // Otherwise, use response as-is
      response = new Response(body, responseOptions);
      resolve(response);
    });

    writeToStream(inputStream, request).catch(reject);
  });
}
