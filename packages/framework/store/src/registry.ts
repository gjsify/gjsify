// @gjsify/store — provider registry. Registration is a deliberate side-effect import.

import type { Commerce, StoreProvider } from './types.js';

const providers = new Map<Commerce, StoreProvider>();

/** Register a store provider. Last registration wins. */
export function registerProvider(provider: StoreProvider): void {
    providers.set(provider.id, provider);
}

/** Return the registered provider for `id`, or `undefined` if none. */
export function getProvider(id: Commerce): StoreProvider | undefined {
    return providers.get(id);
}

/** Remove all registered providers. Mainly for tests. */
export function clearProviders(): void {
    providers.clear();
}
