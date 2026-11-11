// @gjsify/store — resolve what support UI the current channel can offer.

import { channel, CHANNEL_CAPABILITIES, type SupportPath } from '@gjsify/distribution';
import { getProvider } from './registry.js';
import { productsForCommerce } from './catalog.js';
import type { Commerce, SupportOffer } from './types.js';

/** The support path declared for the current build. */
export function supportPath(): SupportPath {
    return CHANNEL_CAPABILITIES[channel].support;
}

/**
 * Resolve what store purchase UI can be offered in this build.
 *
 * - Returns `null` when the channel does not allow store purchases or no provider is registered.
 * - Returns the provider's available products otherwise.
 */
export async function resolveSupport(): Promise<SupportOffer | null> {
    const capabilities = CHANNEL_CAPABILITIES[channel];
    if (capabilities.support !== 'store-purchase' || capabilities.commerce === 'none') {
        return null;
    }
    const commerce: Commerce = capabilities.commerce;
    const provider = getProvider(commerce);
    if (!provider) {
        return null;
    }
    const declarations = productsForCommerce(commerce);
    if (declarations.length === 0) {
        return null;
    }
    const products = await provider.products(declarations.map((declaration) => declaration.id));
    return { provider: provider.id, products };
}
