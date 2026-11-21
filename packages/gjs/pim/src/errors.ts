/**
 * One failure, one type. Consumers branch on these, so a backend never lets a raw native error
 * through: a GLib.Error under GJS is a boxed GObject that JSON-serialises to `{}`.
 */

export class PimError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** The backend cannot load at all on this host (no EDS typelibs, for example). */
export class BackendUnavailableError extends PimError {}

/** A backend call failed; `domain`/`code` carry the GError metadata when there was one. */
export class BackendError extends PimError {
    readonly domain: string | undefined;
    readonly code: number | undefined;

    constructor(message: string, domain?: string, code?: number) {
        super(message);
        this.domain = domain;
        this.code = code;
    }
}

/** An HTTP answer that is not success; `retryAfterMs` is the server's Retry-After (429, 503) when it sent one. */
export class BackendHttpError extends BackendError {
    readonly retryAfterMs: number | undefined;

    constructor(message: string, status: number, retryAfterMs?: number) {
        super(message, 'http', status);
        this.retryAfterMs = retryAfterMs;
    }
}

/** The server rejected the credentials (HTTP 401). Retrying with the same credentials cannot help. */
export class BackendAuthError extends BackendError {}

/**
 * The stored copy changed since it was read, so the write was refused (HTTP 412).
 *
 * Retrying is only correct after re-reading: the edit was computed from text that no longer is
 * what the server holds.
 */
export class ConflictError extends BackendError {}

export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
    return String(err);
}
