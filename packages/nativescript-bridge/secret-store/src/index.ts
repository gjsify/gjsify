// NativeScript driver for @gjsify/secret-store — ADR 0152. Importing this package on a
// NativeScript app installs the platform driver; elsewhere it does nothing, so a shared
// entry point can import it unconditionally.

import { isAndroid, isIOS } from '@gjsify/native-platform';
import { useSecretStoreDriver, type SecretStoreDriver } from '@gjsify/secret-store';

import { createAndroidBackend } from './android.js';
import { createKeystoreFileDriver, type KeystoreFileOptions } from './driver.js';
import { createIosBackend } from './ios.js';

export { createKeystoreFileDriver, fileNameFor } from './driver.js';
export type { KeystoreFileOptions, RawBackend } from './driver.js';

/** The driver for the platform this NativeScript app runs on. Throws off NativeScript. */
export function createNativescriptSecretDriver(options?: KeystoreFileOptions): SecretStoreDriver {
    if (!isAndroid && !isIOS) throw new Error('Platform not supported');
    return createKeystoreFileDriver(isAndroid ? createAndroidBackend() : createIosBackend(), options);
}

if (isAndroid) {
    useSecretStoreDriver(createNativescriptSecretDriver());
}
