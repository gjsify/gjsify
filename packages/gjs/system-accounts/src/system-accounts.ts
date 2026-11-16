// The entry point. `&optional` (ADR 0087) is imported HERE and nowhere else: it costs a
// top-level await in every bundle that reaches it, so the drivers and their specs stay free of it.

import goaNamespace from 'gi://Goa?version=1.0&optional';

import { createDbusAccounts } from './dbus.js';
import { connectSessionBus } from './dbus-gio.js';
import { createGoaAccounts } from './goa.js';
import type { SystemAccounts } from './types.js';

/**
 * The Linux driver on the host's libgoa; without the typelib (a Flatpak runtime ships none)
 * the one that speaks to the GOA daemon over D-Bus, which answers `no-account-store` when the
 * daemon is not reachable.
 */
export function createSystemAccounts(): SystemAccounts {
    return goaNamespace
        ? createGoaAccounts({ goa: goaNamespace })
        : createDbusAccounts({ connect: () => connectSessionBus() });
}
