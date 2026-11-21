/**
 * Lazy, cached access to OPTIONAL GObject-Introspection namespaces. Pure — the `gi://` import
 * lives in the caller's loader thunk — so the degradation is testable on Node.
 *
 * A static `import 'gi://ECal'` throws at module load on a host without Evolution Data Server
 * (macOS, a container) and takes the whole app with it, `--help` included. Loading on first use
 * turns that into a `BackendUnavailableError` every consumer already knows how to report.
 */

import { BackendUnavailableError, errorMessage } from './errors.js';
import { _, fmt } from './i18n.js';

export interface OptionalNamespace<T> {
    get(): Promise<T>;
}

/** Run the loader at most once; a failure is cached too — a missing typelib stays missing. */
export function optionalNamespace<T>(label: string, load: () => Promise<T>): OptionalNamespace<T> {
    let pending: Promise<T> | null = null;
    return {
        get() {
            pending ??= load().catch((err: unknown) => {
                throw new BackendUnavailableError(
                    fmt(_('{label} typelib not available: {message}'), { label, message: errorMessage(err) }),
                );
            });
            return pending;
        },
    };
}
