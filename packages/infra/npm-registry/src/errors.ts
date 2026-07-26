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
