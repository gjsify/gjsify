// The NativeScript-Android answer (ADR 0152): no system account store is exposed to apps, so the
// package answers with empty capabilities. Picked over system-accounts.ts by the `.android`
// platform suffix of `--app nativescript`; that file's `gi://` imports never reach a mobile bundle.

import { noAccountStore } from './no-account-store.js';
import type { SystemAccounts } from './types.js';

export function createSystemAccounts(): SystemAccounts {
    return noAccountStore;
}
