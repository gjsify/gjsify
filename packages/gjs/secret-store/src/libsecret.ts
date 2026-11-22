// The entry point: `import '@gjsify/secret-store/libsecret'` installs the driver for this GJS
// app. It is a subpath, not a side effect of the main entry, because the main entry also loads
// on runtimes that have no `gi://`, and `&optional` (ADR 0087) costs a top-level await in every
// bundle that reaches it.

import Gio from 'gi://Gio?version=2.0';
import secretNamespace from 'gi://Secret?version=1&optional';

import { createLibsecretDriver } from './libsecret-driver.js';
import { useSecretStoreDriver } from './secret-store.js';

/** Install the driver again, e.g. after a test removed it. Importing this module already did. */
export function installLibsecretDriver(): void {
    useSecretStoreDriver(
        createLibsecretDriver({
            secret: secretNamespace,
            // Flatpak mounts this file into every sandbox; the portal, not libsecret, is the way in there.
            sandboxed: Gio.File.new_for_path('/.flatpak-info').query_exists(null),
        }),
    );
}

installLibsecretDriver();
