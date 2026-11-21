/** Maps what `@gjsify/dav` throws onto the port's errors; shared by the backend and the delta reader. */

import { DavError } from '@gjsify/dav';

import { BackendAuthError, BackendError, BackendHttpError, errorMessage } from '../errors.js';
import { _, fmt } from '../i18n.js';

/** Classify a failure; 401 is an auth error, everything else a BackendError naming the call. */
export function davError(label: string, err: unknown): Error {
    if (err instanceof BackendError) return err;
    if (err instanceof DavError) {
        if (err.status === 401)
            return new BackendAuthError(
                fmt(_('{label}: the server rejected the credentials (401)'), { label }),
                'http',
                401,
            );
        return new BackendHttpError(
            fmt(_('{label}: {method} failed with {status}'), { label, method: err.method, status: err.status }),
            err.status,
            err.retryAfterMs ?? undefined,
        );
    }
    return new BackendError(fmt(_('{label}: {message}'), { label, message: errorMessage(err) }));
}
