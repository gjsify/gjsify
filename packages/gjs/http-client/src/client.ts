/**
 * The one way a REST adapter talks to its server. Plain `fetch`, so it runs on GJS (gjsify's Soup
 * fetch) and Node alike.
 *
 * What it does NOT do, on purpose: retry. A 401 or 403 is a decision, and a 429 or a timeout is
 * the caller's schedule to back off on (the sync service owns that). It reports what happened as a
 * typed error and leaves the next attempt to someone who knows the budget.
 */

import {
    ForbiddenError,
    HttpError,
    NetworkError,
    NotFoundError,
    RateLimitedError,
    ResponseFormatError,
    ServerError,
    TimeoutError,
    UnauthorizedError,
} from './errors.js';
import { HostLimiter } from './limiter.js';

export type HttpAuth =
    | { readonly type: 'basic'; readonly username: string; readonly password: string }
    /** Nextcloud-style app password: Basic on the wire, kept apart so config can say what it holds. */
    | { readonly type: 'app-password'; readonly username: string; readonly password: string }
    | { readonly type: 'bearer'; readonly token: string }
    /** A key in a header of its own (Zenkit's `Zenkit-API-Key`); scrubbed from errors like any secret. */
    | { readonly type: 'header'; readonly name: string; readonly value: string };

export type QueryValue = string | number | boolean | undefined;

export interface HttpClientOptions {
    /** Server root, e.g. `https://cloud.example.org/index.php/apps/deck/api/v1.1/`. No credentials in it. */
    readonly baseUrl: string;
    readonly auth?: HttpAuth;
    /** Sent with every request (User-Agent, OCS-APIRequest …). */
    readonly headers?: Record<string, string>;
    /** Per request, queue wait excluded. Default 20 000. */
    readonly timeoutMs?: number;
    /** Shared by default (two requests per host, process-wide); pass your own to change that. */
    readonly limiter?: HostLimiter;
    /** Injected for tests; defaults to global fetch. */
    readonly fetch?: typeof fetch;
}

export interface GetJsonOptions {
    /** Sent as `If-None-Match`; a 304 then comes back as `unchanged`. */
    readonly etag?: string;
    readonly query?: Record<string, QueryValue>;
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    /** A 2xx with an empty body is `ok` with `data` undefined, not a format error (writes that answer "200 Success"). */
    readonly allowEmpty?: boolean;
}

export type JsonResult<T> =
    | { readonly status: 'ok'; readonly data: T; readonly etag: string | undefined; readonly headers: Headers }
    | { readonly status: 'unchanged'; readonly etag: string | undefined };

interface Reply {
    readonly status: number;
    readonly headers: Headers;
    readonly text: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const sharedLimiter = new HostLimiter({ maxConcurrent: 2 });

/** Seconds or an HTTP date → milliseconds from `now`; undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
    const text = value?.trim();
    if (!text) return undefined;
    if (/^\d+$/.test(text)) return Number(text) * 1000;
    const at = Date.parse(text);
    return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export class HttpClient {
    readonly baseUrl: string;
    readonly #authHeader: readonly [name: string, value: string] | undefined;
    /** Everything that must never appear in an error message. */
    readonly #secrets: string[] = [];
    readonly #headers: Record<string, string>;
    readonly #timeoutMs: number;
    readonly #limiter: HostLimiter;
    readonly #fetch: typeof fetch;

    constructor(options: HttpClientOptions) {
        const base = new URL(options.baseUrl);
        if (base.username || base.password) {
            throw new TypeError('baseUrl must not contain credentials; pass `auth` instead');
        }
        if (!base.pathname.endsWith('/')) base.pathname += '/';
        base.search = '';
        base.hash = '';
        this.baseUrl = base.href;

        const auth = options.auth;
        if (auth?.type === 'bearer') {
            this.#authHeader = ['Authorization', `Bearer ${auth.token}`];
            this.#secrets.push(auth.token);
        } else if (auth?.type === 'header') {
            this.#authHeader = [auth.name, auth.value];
            this.#secrets.push(auth.value);
        } else if (auth) {
            const pair = toBase64(`${auth.username}:${auth.password}`);
            this.#authHeader = ['Authorization', `Basic ${pair}`];
            this.#secrets.push(auth.password, pair);
        }
        this.#headers = { ...options.headers };
        this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.#limiter = options.limiter ?? sharedLimiter;
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    }

    /** Serialising a client never reveals its credentials. */
    toJSON(): { baseUrl: string } {
        return { baseUrl: this.baseUrl };
    }

    get origin(): string {
        return new URL(this.baseUrl).origin;
    }

    /**
     * Relative paths hang off the base URL; an absolute URL must stay on the server's origin — the
     * credentials go wherever this resolves, so a link the server hands out cannot redirect them.
     */
    resolve(path: string, query?: Record<string, QueryValue>): URL {
        const url = /^[a-z][a-z0-9+.-]*:/i.test(path) ? new URL(path) : new URL(path.replace(/^\/+/, ''), this.baseUrl);
        if (url.origin !== this.origin) throw new TypeError(`refusing to leave ${this.origin}`);
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return url;
    }

    async getJson<T>(path: string, options: GetJsonOptions = {}): Promise<JsonResult<T>> {
        return this.#requestJson<T>('GET', path, undefined, options);
    }

    /**
     * A JSON body in, JSON out. For query-style POSTs (Zenkit's entry filter); there is no ETag
     * revalidation on it, so `unchanged` never comes back.
     */
    async postJson<T>(path: string, body: unknown, options: GetJsonOptions = {}): Promise<JsonResult<T>> {
        return this.#requestJson<T>('POST', path, JSON.stringify(body), options);
    }

    /** A JSON body with PUT or PATCH (board writes); like `postJson`, no ETag revalidation. */
    async sendJson<T>(
        method: 'PUT' | 'PATCH' | 'POST',
        path: string,
        body: unknown,
        options: GetJsonOptions = {},
    ): Promise<JsonResult<T>> {
        return this.#requestJson<T>(method, path, JSON.stringify(body), options);
    }

    async #requestJson<T>(
        method: string,
        path: string,
        body: string | undefined,
        options: GetJsonOptions,
    ): Promise<JsonResult<T>> {
        const url = this.resolve(path, options.query);
        const where = `${url.origin}${url.pathname}`;
        const headers: Record<string, string> = {
            Accept: 'application/json',
            // gjsify's fetch decodes gzip and deflate but has no Brotli codec.
            'Accept-Encoding': 'gzip, deflate',
            ...this.#headers,
            ...options.headers,
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (options.etag) headers['If-None-Match'] = options.etag;
        if (this.#authHeader) headers[this.#authHeader[0]] = this.#authHeader[1];

        const reply = await this.#limiter.run(url.host, () =>
            this.#exchange(method, url, where, headers, options, body),
        );

        if (reply.status === 304) return { status: 'unchanged', etag: reply.headers.get('etag') ?? options.etag };
        if (reply.status < 200 || reply.status > 299) throw this.#failure(method, reply, where);

        if (reply.text.trim() === '') {
            if (options.allowEmpty) {
                return {
                    status: 'ok',
                    data: undefined as T,
                    etag: reply.headers.get('etag') ?? undefined,
                    headers: reply.headers,
                };
            }
            throw new ResponseFormatError(`${method} ${where} answered HTTP ${reply.status} with an empty body`, {
                status: reply.status,
                url: where,
            });
        }
        try {
            return {
                status: 'ok',
                data: JSON.parse(reply.text) as T,
                etag: reply.headers.get('etag') ?? undefined,
                headers: reply.headers,
            };
        } catch {
            throw new ResponseFormatError(
                `${method} ${where} answered HTTP ${reply.status} with a body that is not JSON`,
                {
                    status: reply.status,
                    url: where,
                },
            );
        }
    }

    async #exchange(
        method: string,
        url: URL,
        where: string,
        headers: Record<string, string>,
        options: GetJsonOptions,
        body?: string,
    ): Promise<Reply> {
        const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        const relay = (): void => controller.abort();
        const signal = options.signal;
        signal?.addEventListener('abort', relay, { once: true });
        if (signal?.aborted) controller.abort();

        try {
            const res = await this.#fetch(url.href, { method, headers, body, signal: controller.signal });
            // The body is read under the same timer: a server that stalls mid-body is a timeout too.
            const text = res.status === 304 ? '' : await res.text();
            return { status: res.status, headers: res.headers, text };
        } catch (err) {
            if (timedOut) {
                throw new TimeoutError(`${method} ${where} timed out after ${timeoutMs} ms`, { url: where });
            }
            if (signal?.aborted) throw err;
            const reason = err instanceof Error ? this.#scrub(err.message) : 'unknown error';
            throw new NetworkError(`${method} ${where} failed: ${reason}`, { url: where });
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', relay);
        }
    }

    #failure(method: string, reply: Reply, where: string): HttpError | UnauthorizedError {
        const status = reply.status;
        const retryAfterMs = parseRetryAfter(reply.headers.get('retry-after'));
        const message = `${method} ${where} answered HTTP ${status}`;
        const details = retryAfterMs === undefined ? { status, url: where } : { status, url: where, retryAfterMs };
        if (status === 401) return new UnauthorizedError(message, details);
        if (status === 403) return new ForbiddenError(message, details);
        if (status === 404) return new NotFoundError(message, details);
        if (status === 429) return new RateLimitedError(message, details);
        if (status >= 500) return new ServerError(message, details);
        return new HttpError(message, details);
    }

    #scrub(text: string): string {
        let out = text;
        for (const secret of this.#secrets) if (secret) out = out.split(secret).join('[redacted]');
        return out;
    }
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
    return new HttpClient(options);
}
