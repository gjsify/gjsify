// iOS is decided (the Keychain, ADR 0152) and not built. This stub fails at the first use,
// naming the platform, rather than at import: an app that ships for both platforms starts.

import type { RawBackend } from './driver.js';

export function createIosBackend(): RawBackend {
    const refuse = (): never => {
        throw new Error(
            '@gjsify/secret-store has no driver for NativeScript iOS yet (ADR 0152: Keychain driver pending)',
        );
    };
    return {
        encrypt: refuse,
        decrypt: refuse,
        deleteKey: refuse,
        hasKey: refuse,
        readFile: refuse,
        writeFileAtomic: refuse,
        deleteFile: refuse,
    };
}
