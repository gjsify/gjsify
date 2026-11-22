import type { SecretStore, SecretStoreDriver } from './types.js';

/** Secrets that live as long as the process. For tests; never selected automatically. */
export function createMemoryDriver(): SecretStoreDriver {
    const namespaces = new Map<string, Map<string, string>>();
    return {
        info: { driver: 'memory', persistent: false, encryptedAtRest: false },
        async open(namespace: string): Promise<SecretStore> {
            let entries = namespaces.get(namespace);
            if (!entries) {
                entries = new Map();
                namespaces.set(namespace, entries);
            }
            const own = entries;
            return {
                namespace,
                async get(key) {
                    return own.get(key) ?? null;
                },
                async set(key, secret) {
                    own.set(key, secret);
                },
                async delete(key) {
                    own.delete(key);
                },
                async keys() {
                    return [...own.keys()];
                },
                async clear() {
                    own.clear();
                },
            };
        },
    };
}
