// Side-effect module: registers globalThis.crypto on GJS if missing or if
// the existing crypto lacks .subtle. On Node.js the alias layer routes this
// subpath to @gjsify/empty so it becomes a no-op.

import { crypto as cryptoInstance } from './index.js';

if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).crypto = cryptoInstance;
}
