import '@girs/gjs/ambient';
import GLib from 'gi://GLib?version=2.0';
import Soup from '@gjsify/types/Soup-3.0';
import Gio from 'gi://Gio?version=2.0';
import * as GioExt from '@gjsify/gio-2.0';
import * as SoupExt from '@gjsify/soup-3.0';

import { URL } from '@gjsify/deno-runtime/ext/url/00_url';

import { Readable } from 'stream';

import Headers from './headers.js';
import Body, {clone, extractContentType, getTotalBytes} from './body.js';
import {isAbortSignal} from './utils/is.js';
// import { getSearch } from './utils/get-search.js';
import {
	validateReferrerPolicy, determineRequestsReferrer, DEFAULT_REFERRER_POLICY
} from './utils/referrer.js';

const INTERNALS = Symbol('Request internals');

/**
 * Check if `obj` is an instance of Request.
 */
 const isRequest = (obj: RequestInfo | URL) => {
	return (
		typeof obj === 'object' &&
		typeof (obj as Request).url === 'string'
	);
};

/** This Fetch API interface represents a resource request. */
export class Request extends Body implements globalThis.Request {
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
    session: SoupExt.ExtSession & Soup.Session;
    message: Soup.Message;
    inputStream?: Gio.InputStream & GioExt.ExtInputStream<Gio.InputStream>;
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
    let parsedURL: URL;
    let requestObj: Partial<Request> = {};

    if(isRequest(input)) {
      parsedURL = new URL((input as Request).url);
      requestObj = input as Request;
    } else {
      parsedURL = new URL(input as string | URL);
    }

    if (parsedURL.username !== '' || parsedURL.password !== '') {
      throw new TypeError(`${parsedURL} is an url with embedded credentials.`);
    }

    let method = init.method || requestObj.method || 'GET';
    if (/^(delete|get|head|options|post|put)$/i.test(method)) {
      method = method.toUpperCase();
    }

    if ((init.body != null || (isRequest(input) && (input as Request).body !== null)) &&
      (method === 'GET' || method === 'HEAD')) {
      throw new TypeError('Request with GET/HEAD method cannot have body');
    }

    const inputBody = init.body ? init.body : (isRequest(input) && (input as Request).body !== null ? clone(input as Request & Body) : null);

    super(inputBody, {
      size: (init as Request).size || (init as any).size || 0
    });

    const headers = new Headers((init.headers || (input as Request).headers || {}) as HeadersInit);

    if (inputBody !== null && !headers.has('Content-Type')) {
      const contentType = extractContentType(inputBody, this);
      if (contentType) {
        headers.set('Content-Type', contentType);
      }
    }

    let signal = isRequest(input) ?
      (input as Request).signal :
      null;
    if ('signal' in init) {
      signal = init.signal;
    }

    if (signal != null && !isAbortSignal(signal)) {
      throw new TypeError('Expected signal to be an instanceof AbortSignal or EventTarget');
    }

    // §5.4, Request constructor steps, step 15.1
    let referrer: string | URL = init.referrer == null ? (input as Request).referrer : init.referrer;
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

    const session = SoupExt.ExtSession.new();
    const message = new Soup.Message({
      method,
      uri: this._uri,
    });

    this[INTERNALS] = {
      method,
      redirect: init.redirect || (input as Request).redirect || 'follow',
      headers,
      parsedURL,
      signal,
      referrer,
      referrerPolicy: '',
      session,
      message,
    };

    // Node-fetch-only options
    this.follow = (init as Request).follow === undefined ? ((input as Request).follow === undefined ? 20 : (input as Request).follow) : (init as Request).follow;
    this.compress = (init as Request).compress === undefined ? ((input as Request).compress === undefined ? true : (input as Request).compress) : (init as Request).compress;
    this.counter = (init as Request).counter || (input as Request).counter || 0;
    this.agent = (init as Request).agent || (input as Request).agent;
    this.highWaterMark = (init as Request).highWaterMark || (input as Request).highWaterMark || 16384;
    this.insecureHTTPParser = (init as Request).insecureHTTPParser || (input as Request).insecureHTTPParser || false;

    // §5.4, Request constructor steps, step 16.
    // Default is empty string per https://fetch.spec.whatwg.org/#concept-request-referrer-policy
    this.referrerPolicy = init.referrerPolicy || (input as Request).referrerPolicy || '';
  }

  /**
   * Custom send method using Soup, used in fetch to send the request
   * @param options 
   * @returns 
   */
  async _send(options: { headers: Headers }) {
    options.headers._appendToSoupMessage(this._message);

    const cancellable = new Gio.Cancellable();

    this[INTERNALS].inputStream = await this._session.sendAsync(this._message, GLib.PRIORITY_DEFAULT, cancellable);

    this[INTERNALS].readable = this[INTERNALS].inputStream.toReadable({});
    
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
  async json(): Promise<any> {
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
 * Convert a Request to Soup request options.
 *
 * @param request - A Request instance
 * @return The options object to be passed to http.request
 */
export const getSoupRequestOptions = (request: Request) => {
	const { parsedURL } = request[INTERNALS];
	const headers = new Headers(request[INTERNALS].headers);

	// Fetch step 1.3
	if (!headers.has('Accept')) {
		headers.set('Accept', '*/*');
	}

	// HTTP-network-or-cache fetch steps 2.4-2.7
	let contentLengthValue = null;
	if (request.body === null && /^(post|put)$/i.test(request.method)) {
		contentLengthValue = '0';
	}

	if (request.body !== null) {
		const totalBytes = getTotalBytes(request);
		// Set Content-Length if totalBytes is a number (that is not NaN)
		if (typeof totalBytes === 'number' && !Number.isNaN(totalBytes)) {
			contentLengthValue = String(totalBytes);
		}
	}

	if (contentLengthValue) {
		headers.set('Content-Length', contentLengthValue);
	}

	// 4.1. Main fetch, step 2.6
	// > If request's referrer policy is the empty string, then set request's referrer policy to the
	// > default referrer policy.
	if (request.referrerPolicy === '') {
		request.referrerPolicy = DEFAULT_REFERRER_POLICY;
	}

	// 4.1. Main fetch, step 2.7
	// > If request's referrer is not "no-referrer", set request's referrer to the result of invoking
	// > determine request's referrer.
	if (request.referrer && request.referrer !== 'no-referrer') {
		request[INTERNALS].referrer = determineRequestsReferrer(request);
	} else {
		request[INTERNALS].referrer = 'no-referrer';
	}

	// 4.5. HTTP-network-or-cache fetch, step 6.9
	// > If httpRequest's referrer is a URL, then append `Referer`/httpRequest's referrer, serialized
	// >  and isomorphic encoded, to httpRequest's header list.
	if (request[INTERNALS].referrer instanceof URL) {
		headers.set('Referer', request.referrer);
	}

	// HTTP-network-or-cache fetch step 2.11
	if (!headers.has('User-Agent')) {
		headers.set('User-Agent', 'node-fetch');
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

	// HTTP-network fetch step 4.2
	// chunked encoding is handled by Node.js

	// const search = getSearch(parsedURL);

	// Pass the full URL directly to request(), but overwrite the following
	// options:
	const options = {
		// Overwrite search to retain trailing ? (issue #776)
		// path: parsedURL.pathname + search,
		// The following options are not expressed in the URL
		// method: request.method,
		headers,
		// insecureHTTPParser: request.insecureHTTPParser,
		// agent
	};

	return {
		parsedURL,
		options
	};
};