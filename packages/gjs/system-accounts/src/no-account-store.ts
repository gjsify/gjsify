import type { SystemAccounts, Unavailable } from './types.js';

const UNAVAILABLE: Unavailable = { kind: 'unavailable', reason: 'no-account-store' };

/** The answer of a host with no account store: nothing is listed, every question gets a reason. */
export const noAccountStore: SystemAccounts = {
    capabilities: () => ({ services: [], credentials: [] }),
    listAccounts: async () => [],
    getMailSettings: async () => UNAVAILABLE,
    getCredentials: async () => UNAVAILABLE,
};

export function isUnavailable<T extends object>(answer: T | Unavailable): answer is Unavailable {
    return 'kind' in answer && answer.kind === 'unavailable';
}
