// Side-effect module: registers globalThis.crypto on GJS if missing or if
// the existing crypto lacks .subtle. On Node.js the alias layer routes this
// subpath to @gjsify/empty so it becomes a no-op.

import { crypto as cryptoInstance } from './index.js';

/** Module-local typed view of the globals this file writes. */
interface _WebCryptoGlobals {
    crypto?: typeof cryptoInstance;
}

const g = globalThis as unknown as _WebCryptoGlobals;

if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
    g.crypto = cryptoInstance;
}
