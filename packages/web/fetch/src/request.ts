// SPDX-License-Identifier: MIT
// Adapted from node-fetch (https://github.com/node-fetch/node-fetch/blob/main/src/request.js)
// Copyright (c) node-fetch contributors. MIT license.
// Modifications: Rewritten for GJS using Soup.Message and Gio

import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import { soupSendAsync, inputStreamToReadable } from './utils/soup-helpers.js';

import { URL } from '@gjsify/url';
import { Blob } from './utils/blob-from.js';

import { Readable } from 'node:stream';

import Headers from './headers.js';
import Body, {clone, extractContentType, getTotalBytes} from './body.js';
import {isAbortSignal} from './utils/is.js';
import type { FormData } from '@gjsify/formdata';
import {
	validateReferrerPolicy, determineRequestsReferrer, DEFAULT_REFERRER_POLICY
} from './utils/referrer.js';

const INTERNALS = Symbol('Request internals');

/** Properties that may exist on a Request-like object (used for safe casting). */
interface RequestLike {
  url?: string;
  method?: string;
  headers?: Headers | HeadersInit;
  redirect?: RequestRedirect;
  signal?: AbortSignal | null;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  body?: BodyInit | null;
  follow?: number;
  compress?: boolean;
  counter?: number;
  agent?: string | ((url: URL) => string);
  highWaterMark?: number;
  insecureHTTPParser?: boolean;
  size?: number;
}

/**
 * Check if `obj` is an instance of Request.
 */
 const isRequest = (obj: RequestInfo | URL | Request): boolean => {
	return (
		typeof obj === 'object' &&
		typeof (obj as RequestLike).url === 'string'
	);
};

// @ts-expect-error — declaration merging with globalThis.Request for Fetch API compatibility
export interface Request extends globalThis.Request {}

/** This Fetch API interface represents a resource request. */
export class Request extends Body {
  /** Returns the cache mode associated with request, which is a string indicating how the request will interact with the browser's cache when fetching. */
  readonly cache: RequestCache;
  /** Returns the credentials mode associated with request, which is a string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. */
  readonly credentials: RequestCredentials;
  /** Returns the kind of resource requested by request, e.g., "document" or "script". */
  readonly destination: RequestDestination;
  /** Returns a Headers object consisting of the headers associated with request. Note that headers added in the network layer by the user agent will not be accounted for in this object, e.g., the "Host" header. */
  get headers(): Headers {
    return this[INTERNALS].headers;
  }
  /** Returns request's subresource integrity metadata, which is a cryptographic hash of the resource being fetched. Its value consists of multiple hashes separated by whitespace. [SRI] */
  readonly integrity: string;
  /** Returns a boolean indicating whether or not request can outlive the global in which it was created. */
  readonly keepalive: boolean;
  /** Returns request's HTTP method, which is "GET" by default. */
  get method(): string {
    return this[INTERNALS].method;
  }
  /** Returns the mode associated with request, which is a string indicating whether the request will use CORS, or will be restricted to same-origin URLs. */
  readonly mode: RequestMode;
  /** Returns the redirect mode associated with request, which is a string indicating how redirects for the request will be handled during fetching. A request will follow redirects by default. */
  get redirect(): RequestRedirect {
    return this[INTERNALS].redirect;
  }
  /**
   * Returns the referrer of request.
   * Its value can be a same-origin URL if explicitly set in init, the empty string to indicate no referrer, and "about:client" when defaulting to the global's default.
   * This is used during fetching to determine the value of the `Referer` header of the request being made.
   * @see https://fetch.spec.whatwg.org/#dom-request-referrer
   **/
  get referrer(): string {
    if (this[INTERNALS].referrer === 'no-referrer') {
      return '';
    }

    if (this[INTERNALS].referrer === 'client') {
      return 'about:client';
    }

    if (this[INTERNALS].referrer) {
      return this[INTERNALS].referrer.toString();
    }

    return undefined;
  }
  /** Returns the referrer policy associated with request. This is used during fetching to compute the value of the request's referrer. */
  get referrerPolicy(): ReferrerPolicy {
    return this[INTERNALS].referrerPolicy;
  }
  set referrerPolicy(referrerPolicy) {
    this[INTERNALS].referrerPolicy = validateReferrerPolicy(referrerPolicy);
  }
  /** Returns the signal associated with request, which is an AbortSignal object indicating whether or not request has been aborted, and its abort event handler. */
  get signal(): AbortSignal {
    return this[INTERNALS].signal;
  }
  /** Returns the URL of request as a string. */
  get url(): string {
    return this[INTERNALS].parsedURL.toString();
  }

  get _uri() {
    return GLib.Uri.parse(this.url, GLib.UriFlags.NONE);
  }

  get _session() {
    return this[INTERNALS].session;
  }

  get _message() {
    return this[INTERNALS].message;
  }

  get _inputStream() {
    return this[INTERNALS].inputStream;
  }

  get [Symbol.toStringTag]() {
    return 'Request';
  }

  [INTERNALS]: {
    // node-fetch
    method: string;
    redirect: RequestRedirect;
    headers: Headers;
    parsedURL: URL;
    signal: AbortSignal;
    referrer: string | URL;
    referrerPolicy: ReferrerPolicy;
    // Gjsify
    session: Soup.Session | null;
    message: Soup.Message | null;
    inputStream?: Gio.InputStream;
    readable?: Readable
  };

  // Node-fetch-only options
  follow: number;
  compress = false;
  counter = 0
  agent: string | ((url: URL) => string) = ''
  highWaterMark = 16384;
  insecureHTTPParser = false;

  constructor(input: RequestInfo | URL | Request, init?: RequestInit) {
    const inputRL = input as unknown as RequestLike;
    const initRL = (init || {}) as unknown as RequestLike;

    let parsedURL: URL;
    let requestObj: RequestLike = {};

    if(isRequest(input)) {
      parsedURL = new URL(inputRL.url);
      requestObj = inputRL;
    } else {
      parsedURL = new URL(input as string | URL);
    }

    if (parsedURL.username !== '' || parsedURL.password !== '') {
      throw new TypeError(`${parsedURL} is an url with embedded credentials.`);
    }

    let method = initRL.method || requestObj.method || 'GET';
    if (/^(delete|get|head|options|post|put)$/i.test(method)) {
      method = method.toUpperCase();
    }

    if ((init?.body != null || (isRequest(input) && inputRL.body !== null)) &&
      (method === 'GET' || method === 'HEAD')) {
      throw new TypeError('Request with GET/HEAD method cannot have body');
    }

    const inputBody = init?.body ? init.body : (isRequest(input) && inputRL.body !== null ? clone(input as unknown as Request & Body) : null);

    super(inputBody, {
      size: initRL.size || 0
    });

    const headers = new Headers((init?.headers || inputRL.headers || {}) as HeadersInit);

    if (inputBody !== null && !headers.has('Content-Type')) {
      const contentType = extractContentType(inputBody, this);
      if (contentType) {
        headers.set('Content-Type', contentType);
      }
    }

    let signal = isRequest(input) ?
      inputRL.signal :
      null;
    if (init && 'signal' in init) {
      signal = init.signal;
    }

    if (signal != null && !isAbortSignal(signal)) {
      throw new TypeError('Expected signal to be an instanceof AbortSignal or EventTarget');
    }

    // §5.4, Request constructor steps, step 15.1
    let referrer: string | URL = init?.referrer == null ? inputRL.referrer : init.referrer;
    if (referrer === '') {
      // §5.4, Request constructor steps, step 15.2
      referrer = 'no-referrer';
    } else if (referrer) {
      // §5.4, Request constructor steps, step 15.3.1, 15.3.2
      const parsedReferrer = new URL(referrer);
      // §5.4, Request constructor steps, step 15.3.3, 15.3.4
      referrer = /^about:(\/\/)?client$/.test(parsedReferrer.toString()) ? 'client' : parsedReferrer;
    } else {
      referrer = undefined;
    }

    // Only create Soup objects for HTTP/HTTPS — data: URIs etc. don't go through Soup
    const scheme = parsedURL.protocol;
    let session: Soup.Session | null = null;
    let message: Soup.Message | null = null;
    if (scheme === 'http:' || scheme === 'https:') {
      session = new Soup.Session();
      message = new Soup.Message({
        method,
        uri: GLib.Uri.parse(parsedURL.toString(), GLib.UriFlags.NONE),
      });
    }

    this[INTERNALS] = {
      method,
      redirect: init?.redirect || inputRL.redirect || 'follow',
      headers,
      parsedURL,
      signal,
      referrer,
      referrerPolicy: '',
      session,
      message,
    };

    // Node-fetch-only options
    this.follow = initRL.follow === undefined ? (inputRL.follow === undefined ? 20 : inputRL.follow) : initRL.follow;
    this.compress = initRL.compress === undefined ? (inputRL.compress === undefined ? true : inputRL.compress) : initRL.compress;
    this.counter = initRL.counter || inputRL.counter || 0;
    this.agent = initRL.agent || inputRL.agent;
    this.highWaterMark = initRL.highWaterMark || inputRL.highWaterMark || 16384;
    this.insecureHTTPParser = initRL.insecureHTTPParser || inputRL.insecureHTTPParser || false;

    // §5.4, Request constructor steps, step 16.
    // Default is empty string per https://fetch.spec.whatwg.org/#concept-request-referrer-policy
    this.referrerPolicy = init?.referrerPolicy || inputRL.referrerPolicy || '';
  }

  /**
   * Send the request using Soup.
   */
  async _send(options: { headers: Headers }) {
    const { session, message } = this[INTERNALS];

    if (!session || !message) {
      throw new Error('Cannot send request: no Soup session (non-HTTP URL?)');
    }

    options.headers._appendToSoupMessage(message);

    // Attach the request body to the Soup message (needed for POST/PUT/PATCH).
    // Use _rawBodyBuffer to read the body without consuming the stream (the
    // `body` getter may have already put the internal Readable into flowing mode,
    // draining its buffer before we get here).
    const rawBuf = this._rawBodyBuffer;
    if (rawBuf !== null && rawBuf.byteLength > 0) {
      message.set_request_body_from_bytes(null, new GLib.Bytes(rawBuf));
    }

    const cancellable = new Gio.Cancellable();

    this[INTERNALS].inputStream = await soupSendAsync(session, message, GLib.PRIORITY_DEFAULT, cancellable);
    this[INTERNALS].readable = inputStreamToReadable(this[INTERNALS].inputStream);

    return {
      inputStream: this[INTERNALS].inputStream,
      readable: this[INTERNALS].readable,
      cancellable
    }
  }

  /**
   * Clone this request
   */
  clone(): Request {
    return new Request(this);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return super.arrayBuffer();
  }
  async blob(): Promise<Blob> {
    return super.blob();
  }
  async formData(): Promise<FormData> {
    return super.formData();
  }
  async json(): Promise<unknown> {
    return super.json();
  }
  async text(): Promise<string> {
    return super.text();
  }
}

Object.defineProperties(Request.prototype, {
	method: {enumerable: true},
	url: {enumerable: true},
	headers: {enumerable: true},
	redirect: {enumerable: true},
	clone: {enumerable: true},
	signal: {enumerable: true},
	referrer: {enumerable: true},
	referrerPolicy: {enumerable: true}
});

export default Request;

/**
 * @param request
 */
export const getSoupRequestOptions = (request: Request) => {
	const { parsedURL } = request[INTERNALS];
	const headers = new Headers(request[INTERNALS].headers);

	// Fetch step 1.3
	if (!headers.has('Accept')) {
		headers.set('Accept', '*/*');
	}

	// HTTP-network-or-cache fetch steps 2.4-2.7
	let contentLengthValue: string | null = null;
	if (request.body === null && /^(post|put)$/i.test(request.method)) {
		contentLengthValue = '0';
	}

	if (request.body !== null) {
		const totalBytes = getTotalBytes(request);
		// Set Content-Length if totalBytes is a Number (that is not NaN)
		if (typeof totalBytes === 'number' && !Number.isNaN(totalBytes)) {
			contentLengthValue = String(totalBytes);
		}
	}

	if (contentLengthValue) {
		headers.set('Content-Length', contentLengthValue);
	}

	// 4.1. Main fetch, step 2.6
	if (request.referrerPolicy === '') {
		request.referrerPolicy = DEFAULT_REFERRER_POLICY;
	}

	// 4.1. Main fetch, step 2.7
	if (request.referrer && request.referrer !== 'no-referrer') {
		request[INTERNALS].referrer = determineRequestsReferrer(request);
	} else {
		request[INTERNALS].referrer = 'no-referrer';
	}

	// 4.5. HTTP-network-or-cache fetch, step 6.9
	if (request[INTERNALS].referrer instanceof URL) {
		headers.set('Referer', request.referrer);
	}

	// HTTP-network-or-cache fetch step 2.11
	if (!headers.has('User-Agent')) {
		headers.set('User-Agent', 'gjsify-fetch');
	}

	// HTTP-network-or-cache fetch step 2.15
	if (request.compress && !headers.has('Accept-Encoding')) {
		headers.set('Accept-Encoding', 'gzip, deflate, br');
	}

	let { agent } = request;
	if (typeof agent === 'function') {
		agent = agent(parsedURL);
	}

	if (!headers.has('Connection') && !agent) {
		headers.set('Connection', 'close');
	}

	const options = {
		headers,
	};

	return {
		parsedURL,
		options
	};
};
