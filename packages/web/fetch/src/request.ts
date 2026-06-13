// SPDX-License-Identifier: MIT
// Adapted from node-fetch (https://github.com/node-fetch/node-fetch/blob/main/src/request.js)
// Copyright (c) node-fetch contributors. MIT license.
// Modifications: Rewritten for GJS using Soup.Message and Gio

import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import { soupSendAsync, inputStreamToReadable } from './utils/soup-helpers.js';

import { URL } from '@gjsify/url';
import type { Blob } from './utils/blob-from.js';

import type { Readable } from 'node:stream';

import Headers from './headers.js';
import Body, { clone, extractContentType, getTotalBytes } from './body.js';
import { isAbortSignal } from './utils/is.js';
import type { FormData } from '@gjsify/formdata';
import { validateReferrerPolicy, determineRequestsReferrer, DEFAULT_REFERRER_POLICY } from './utils/referrer.js';

const INTERNALS = Symbol('Request internals');

/**
 * Process-wide shared `Soup.Session`.
 *
 * Why a singleton and not a fresh `new Soup.Session()` per request:
 *
 * libsoup's connection manager keeps each open connection registered on a
 * per-host list (`SoupHost.conns`). That list is only emptied when the
 * connection's `disconnected` signal is processed on the main loop. When a
 * `Soup.Session` is *finalized* its connection manager is torn down
 * (`soup_connection_manager_free` → `soup_host_free`), which asserts the host
 * has no live connections — `g_warn_if_fail (host->conns == NULL)`. If a
 * session is dropped while a connection is still registered (the disconnect
 * hasn't been pumped yet), libsoup prints:
 *
 *     (gjs:…): libsoup-CRITICAL **: runtime check failed: (host->conns == NULL)
 *
 * Under GJS this is a SpiderMonkey-GC race: a per-request session (the old
 * behavior — one `new Soup.Session()` per `Request`) becomes garbage as soon as
 * the `Response` body is read, and a GC sweep can finalize it on the very same
 * turn the connection is still being cleaned up. The same class of GLib/Soup
 * BoxedInstance GC race is mitigated elsewhere in gjsify (e.g. `@gjsify/timers`
 * uses `GLib.timeout_add` instead of holding `GLib.Source` boxed instances).
 *
 * Holding one long-lived session at module scope keeps it permanently reachable
 * (never GC-finalized for the lifetime of the program), so the teardown path
 * that fires the assertion is never reached mid-flight. It also lets libsoup
 * pool and reuse keep-alive connections across requests — a real win for
 * heavy fetch users like `@gjsify/npm-registry` during `gjsify install`.
 *
 * Lazily created so merely importing `@gjsify/fetch` (e.g. for `Headers`/
 * `Request`/`Response` types on Node, or in a browser bundle) does not
 * instantiate a Soup object.
 */
let sharedSession: Soup.Session | null = null;

/**
 * Connections libsoup may open per host (and overall) on the shared session.
 *
 * libsoup's default `max-conns-per-host` is a conservative **2**, which
 * serialises bulk-fetch workloads to two-at-a-time even over a multiplexed
 * HTTP/2 connection. `@gjsify/npm-registry` (during `gjsify install`) hammers
 * a single host — the npm registry — with hundreds of packument + tarball
 * GETs; at the default cap a 16-wide download pool was measured stalling at
 * ~2 effective in-flight requests (16 packuments in ~3.0s vs ~0.24s once the
 * cap is lifted — a 12× difference, same h2 connection).
 *
 * 16 matches npm's `maxsockets` (15) and pnpm's `network-concurrency` (16)
 * defaults and is browser-competitive (Chrome uses 6 per host for HTTP/1.1,
 * more via h2 stream multiplexing). It is harmless for light fetch users, who
 * never materialise more than a couple of concurrent requests to one host.
 * Override per-host with `GJSIFY_FETCH_MAX_CONNS_PER_HOST` and the global
 * ceiling with `GJSIFY_FETCH_MAX_CONNS`.
 */
const DEFAULT_MAX_CONNS_PER_HOST = 16;
const DEFAULT_MAX_CONNS = 64;

function envPositiveInt(name: string, fallback: number): number {
    const raw = GLib.getenv(name);
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getSharedSession(): Soup.Session {
    if (sharedSession === null) {
        const maxPerHost = envPositiveInt('GJSIFY_FETCH_MAX_CONNS_PER_HOST', DEFAULT_MAX_CONNS_PER_HOST);
        // The global ceiling must be ≥ the per-host cap, else libsoup clamps
        // the per-host value down to it.
        const maxConns = Math.max(envPositiveInt('GJSIFY_FETCH_MAX_CONNS', DEFAULT_MAX_CONNS), maxPerHost);
        // `max-conns` / `max-conns-per-host` are construct-only in libsoup 3 —
        // they MUST be passed to the constructor; the setters don't exist.
        sharedSession = new Soup.Session({
            maxConns,
            maxConnsPerHost: maxPerHost,
        });
        // Soup auto-adds a ContentDecoder to new sessions, but it decodes the
        // body without removing the Content-Encoding header, causing
        // double-decompression when index.ts also runs DecompressionStream.
        // Remove it once here so our JS-level decompression handles everything.
        try {
            sharedSession.remove_feature_by_type(Soup.ContentDecoder.$gtype);
        } catch {
            /* not present */
        }
    }
    return sharedSession;
}

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
    return typeof obj === 'object' && typeof (obj as RequestLike).url === 'string';
};

// @ts-expect-error — declaration merging with globalThis.Request for Fetch API compatibility
// oxlint-disable-next-line no-unsafe-declaration-merging -- intentional: merge globalThis.Request into our Request class
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
        // ENCODED, not NONE: `this.url` (a WHATWG-serialized URL) is already
        // percent-encoded, so re-parsing with NONE would DECODE it a second
        // time — turning an intentionally-escaped `%2F` in a path segment back
        // into a literal `/`. That breaks scoped-package registry routes like
        // `PUT /@scope%2Fname` (npm's package-create + OIDC token-exchange
        // endpoints 404 on the decoded `/@scope/name` form). ENCODED preserves
        // the existing escaping on round-trip. See request.ts uri construction.
        return GLib.Uri.parse(this.url, GLib.UriFlags.ENCODED);
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
        readable?: Readable;
    };

    // Node-fetch-only options
    follow: number;
    compress = false;
    counter = 0;
    agent: string | ((url: URL) => string) = '';
    highWaterMark = 16384;
    insecureHTTPParser = false;

    constructor(input: RequestInfo | URL | Request, init?: RequestInit) {
        const inputRL = input as unknown as RequestLike;
        const initRL = (init || {}) as unknown as RequestLike;

        let parsedURL: URL;
        let requestObj: RequestLike = {};

        if (isRequest(input)) {
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

        if (
            (init?.body != null || (isRequest(input) && inputRL.body !== null)) &&
            (method === 'GET' || method === 'HEAD')
        ) {
            throw new TypeError('Request with GET/HEAD method cannot have body');
        }

        const inputBody = init?.body
            ? init.body
            : isRequest(input) && inputRL.body !== null
              ? clone(input as unknown as Request & Body)
              : null;

        super(inputBody, {
            size: initRL.size || 0,
        });

        const headers = new Headers((init?.headers || inputRL.headers || {}) as HeadersInit);

        if (inputBody !== null && !headers.has('Content-Type')) {
            const contentType = extractContentType(inputBody, this);
            if (contentType) {
                headers.set('Content-Type', contentType);
            }
        }

        let signal = isRequest(input) ? inputRL.signal : null;
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
            // Reuse the process-wide shared session (see getSharedSession docs):
            // a per-request session that gets GC-finalized while a connection is
            // still registered on its host triggers libsoup's
            // `host->conns == NULL` CRITICAL.
            session = getSharedSession();
            message = new Soup.Message({
                method,
                // ENCODED, not NONE: `parsedURL.toString()` is already a
                // percent-encoded WHATWG URL. Parsing with NONE decodes it a
                // second time, collapsing an escaped `%2F` in a path segment to
                // a literal `/` — which sends `PUT /@scope/name` instead of the
                // required `PUT /@scope%2Fname`. npm's registry tolerates the
                // literal slash when UPDATING an existing package but 404s on
                // the package-CREATE route and the OIDC token-exchange endpoint
                // (`/-/npm/v1/oidc/token/exchange/package/@scope%2Fname`), which
                // broke first-publish of new scoped packages + Trusted-Publisher
                // OIDC auth once the CLI began running under GJS. ENCODED keeps
                // the escaping intact on the wire.
                uri: GLib.Uri.parse(parsedURL.toString(), GLib.UriFlags.ENCODED),
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
        this.follow =
            initRL.follow === undefined ? (inputRL.follow === undefined ? 20 : inputRL.follow) : initRL.follow;
        this.compress =
            initRL.compress === undefined
                ? inputRL.compress === undefined
                    ? true
                    : inputRL.compress
                : initRL.compress;
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

        // ContentDecoder is removed once on the shared session in
        // getSharedSession() (so the Content-Encoding header survives for our
        // JS-level DecompressionStream in index.ts). Nothing per-request here.

        options.headers._appendToSoupMessage(message);

        // Attach the request body to the Soup message (needed for POST/PUT/PATCH).
        // Use _rawBodyBuffer to read the body without consuming the stream (the
        // `body` getter may have already put the internal Readable into flowing mode,
        // draining its buffer before we get here).
        const rawBuf = this._rawBodyBuffer;
        if (rawBuf !== null && rawBuf.byteLength > 0) {
            const contentType = options.headers.get('content-type') || null;
            message.set_request_body_from_bytes(contentType, new GLib.Bytes(rawBuf));
        }

        const cancellable = new Gio.Cancellable();

        this[INTERNALS].inputStream = await soupSendAsync(session, message, GLib.PRIORITY_DEFAULT, cancellable);
        this[INTERNALS].readable = inputStreamToReadable(this[INTERNALS].inputStream);

        return {
            inputStream: this[INTERNALS].inputStream,
            readable: this[INTERNALS].readable,
            cancellable,
        };
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
    method: { enumerable: true },
    url: { enumerable: true },
    headers: { enumerable: true },
    redirect: { enumerable: true },
    clone: { enumerable: true },
    signal: { enumerable: true },
    referrer: { enumerable: true },
    referrerPolicy: { enumerable: true },
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

    // HTTP-network-or-cache fetch step 2.15. Brotli ('br') is omitted: SpiderMonkey
    // 128's DecompressionStream supports only 'gzip' and 'deflate', so advertising
    // 'br' would let servers respond with bodies we cannot decode.
    if (request.compress && !headers.has('Accept-Encoding')) {
        headers.set('Accept-Encoding', 'gzip, deflate');
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
        options,
    };
};
