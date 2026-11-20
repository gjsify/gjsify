import { BackendError, BackendUnavailableError, errorMessage } from '../errors.js';
import { _, fmt } from '../i18n.js';

/**
 * Wrap a native failure as a BackendError naming the call. GJS reports a GError's domain as a
 * quark NUMBER, node-gi as its name; only the name is kept, so the field means one thing.
 */
export function edsError(message: string, cause?: unknown): BackendError {
    const source = cause as { domain?: unknown; code?: unknown } | undefined;
    const domain = typeof source?.domain === 'string' ? source.domain : undefined;
    const code = typeof source?.code === 'number' ? source.code : undefined;
    return new BackendError(
        cause === undefined ? message : fmt(_('{message}: {cause}'), { message, cause: errorMessage(cause) }),
        domain,
        code,
    );
}

/** An error that already names its cause and passes a boundary unchanged. */
export function isBackendFailure(err: unknown): err is BackendError | BackendUnavailableError {
    return err instanceof BackendError || err instanceof BackendUnavailableError;
}

/**
 * Normalise a promisified EDS result. GJS marshals `(gboolean, out T)` as `[success, value]`
 * while the @girs types declare `Promise<T>`; node-gi and older GJS hand back the value alone.
 */
export function unwrapResult<T>(result: unknown): T {
    if (Array.isArray(result) && result.length === 2 && typeof result[0] === 'boolean') return result[1] as T;
    if (Array.isArray(result) && result.length === 1) return result[0] as T;
    return result as T;
}

export function unwrapList<T>(result: unknown): T[] {
    const value = unwrapResult<unknown>(result);
    return Array.isArray(value) ? (value as T[]) : [];
}
