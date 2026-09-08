// Typed errors thrown by the npm registry client.

export class PackageNotFoundError extends Error {
    constructor(
        public readonly name: string,
        public readonly url: string,
    ) {
        super(`Package not found in registry: ${name} (${url})`);
        this.name = 'PackageNotFoundError';
    }
}

export class IntegrityError extends Error {
    constructor(
        public readonly url: string,
        public readonly integrity: string,
    ) {
        super(`Tarball integrity mismatch for ${url} (expected ${integrity})`);
        this.name = 'IntegrityError';
    }
}

/**
 * Thrown when EVERY retry attempt against a registry URL exhausts the
 * per-request timeout (`opts.timeoutMs`, default 30s). Replaces the
 * inscrutable "signal is aborted without reason" the raw AbortSignal path
 * would otherwise surface — `gjsify install` users seeing this know exactly
 * what timed out, how long they waited, and that the CDN is the suspect.
 */
export class RegistryTimeoutError extends Error {
    constructor(
        public readonly url: string,
        public readonly timeoutMs: number,
        public readonly attempts: number,
    ) {
        const seconds = Math.round(timeoutMs / 100) / 10;
        const totalSeconds = Math.round((timeoutMs * attempts) / 100) / 10;
        super(
            `@gjsify/npm-registry: GET ${url} timed out after ${seconds}s × ${attempts} attempt(s) ` +
                `(total ~${totalSeconds}s). This usually means the registry CDN is slow or unreachable.`,
        );
        this.name = 'RegistryTimeoutError';
    }
}

/**
 * Thrown when every retry attempt against a registry URL fails at the network
 * layer (`fetch` rejects, the connection resets, the body stops arriving
 * mid-stream). The sibling of {@link RegistryTimeoutError} for the case where
 * the request does not hang but dies.
 *
 * It exists for the same reason: the raw error the runtime hands us is
 * `TypeError: fetch failed` (undici) or a bare `FetchError` (GJS/libsoup),
 * neither of which says WHICH of an install's several thousand requests died,
 * how many attempts it got, or how long it was given. A CI log that ends in one
 * unattributed `fetch failed` line is not enough to tell a registry outage from
 * a bug, which is what happened to gjsify's own macOS run on 2026-09-08.
 *
 * The underlying error stays reachable as `cause`.
 */
export class RegistryUnreachableError extends Error {
    constructor(
        public readonly url: string,
        public readonly attempts: number,
        public readonly elapsedMs: number,
        cause: unknown,
    ) {
        const seconds = Math.round(elapsedMs / 100) / 10;
        const reason = cause instanceof Error ? cause.message : String(cause);
        super(
            `@gjsify/npm-registry: GET ${url} failed after ${attempts} attempt(s) over ~${seconds}s: ${reason}. ` +
                `This usually means the registry or the network dropped out.`,
        );
        this.name = 'RegistryUnreachableError';
        this.cause = cause;
    }
}
