/**
 * One failure, one type. Every error extends the port's `BackendError` (401 extends
 * `BackendAuthError`) with `domain: 'http'` and the status in `code`, so a sync service that
 * classifies backend failures needs no second code path for REST sources.
 *
 * Messages carry method, origin, path and status — never a header, a query string, a response
 * body or a credential.
 */

import { BackendAuthError, BackendError } from '@gjsify/pim';

export interface HttpErrorDetails {
    /** HTTP status; absent for a timeout or a network failure. */
    readonly status?: number;
    /** Origin + path of the request, without query or credentials. */
    readonly url: string;
    /** The server's Retry-After in milliseconds, when it sent one. */
    readonly retryAfterMs?: number;
}

export interface HttpFailure {
    readonly status: number | undefined;
    readonly url: string;
    readonly retryAfterMs: number | undefined;
}

/** Any other non-success answer (400, 409, 410 …); the specific classes below extend it. */
export class HttpError extends BackendError implements HttpFailure {
    readonly status: number | undefined;
    readonly url: string;
    readonly retryAfterMs: number | undefined;

    constructor(message: string, details: HttpErrorDetails) {
        super(message, 'http', details.status);
        this.status = details.status;
        this.url = details.url;
        this.retryAfterMs = details.retryAfterMs;
    }
}

/** 401: the credentials were rejected. Retrying with the same ones cannot help. */
export class UnauthorizedError extends BackendAuthError implements HttpFailure {
    readonly status: number | undefined;
    readonly url: string;
    readonly retryAfterMs: number | undefined;

    constructor(message: string, details: HttpErrorDetails) {
        super(message, 'http', details.status);
        this.status = details.status;
        this.url = details.url;
        this.retryAfterMs = details.retryAfterMs;
    }
}

/** 403: authenticated, but not allowed. A decision of the server, not a hiccup. */
export class ForbiddenError extends HttpError {}
export class NotFoundError extends HttpError {}
/** 429; `retryAfterMs` is set when the server named a wait. */
export class RateLimitedError extends HttpError {}
/** 5xx; `retryAfterMs` is set when the server named a wait (a 503 with one is a rate limit). */
export class ServerError extends HttpError {}
export class TimeoutError extends HttpError {}
/** No answer at all: refused, reset, DNS. */
export class NetworkError extends HttpError {}
/** A 2xx whose body is not what was asked for (not JSON, empty, a page that is not an array). */
export class ResponseFormatError extends HttpError {}

export function isHttpFailure(err: unknown): err is HttpError | UnauthorizedError {
    return err instanceof HttpError || err instanceof UnauthorizedError;
}
