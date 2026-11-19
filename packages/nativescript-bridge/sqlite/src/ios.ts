// iOS is decided (system SQLite3 C functions through the NativeScript iOS bridge, ADR 0147
// decision 3) and not built. This stub fails at the first call, with that sentence, rather
// than at import: an app that bundles node:sqlite for both platforms still starts.

import type { RawBackend } from './driver.js';

export function createIosBackend(): RawBackend {
    return {
        open(): never {
            throw new Error(
                'node:sqlite is not implemented on NativeScript iOS yet (ADR 0147: system SQLite3 driver pending)',
            );
        },
    };
}
