// The entry point. `&optional` (ADR 0087) is imported HERE and nowhere else: it costs a
// top-level await in every bundle that reaches it, so the driver and its specs stay free of it.

import goaNamespace from 'gi://Goa?version=1.0&optional';

import { createGoaAccounts } from './goa.js';
import type { SystemAccounts } from './types.js';

/** The Linux driver on the host's libgoa, or the no-store answer when the host has none. */
export function createSystemAccounts(): SystemAccounts {
    return createGoaAccounts({ goa: goaNamespace });
}
