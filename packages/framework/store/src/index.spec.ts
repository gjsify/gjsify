// @gjsify/store — core behaviour. Runs on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import {
    clearProviders,
    getCatalog,
    getProvider,
    owns,
    registerCatalog,
    registerProvider,
    resetEntitlementCache,
    resolveSupport,
    supportPath,
    unavailableProvider,
    validateCatalog,
} from './index.js';

export default async () => {
    await describe('@gjsify/store', async () => {
        await it('starts with no registered provider', async () => {
            clearProviders();
            expect(getProvider('microsoft')).toBeUndefined();
            expect(getProvider('apple')).toBeUndefined();
        });

        await it('registers and retrieves a provider', async () => {
            clearProviders();
            registerProvider(unavailableProvider);
            expect(getProvider('none')).toBe(unavailableProvider);
        });

        await it('returns null from resolveSupport when no channel declares store purchases', async () => {
            clearProviders();
            resetEntitlementCache();
            const offer = await resolveSupport();
            expect(offer).toBeNull();
        });

        await it('reports the support path from the current channel', async () => {
            expect(supportPath()).toBe('none');
        });

        await it('registers and returns the product catalog', async () => {
            registerCatalog([
                { id: 'support.small', kind: 'tip', stores: { microsoft: '9NSMALL' } },
                { id: 'pro', kind: 'unlock', stores: { apple: 'eu.jumplink.pro' } },
            ]);
            const catalog = getCatalog();
            expect(catalog.length).toBe(2);
            expect(catalog[0]?.id).toBe('support.small');
            expect(catalog[1]?.id).toBe('pro');
        });

        await it('validates that a product is not declared for commerce none', async () => {
            let threw = false;
            try {
                validateCatalog([{ id: 'bad', kind: 'tip', stores: { none: 'nope' } }]);
            } catch (error) {
                threw = true;
            }
            expect(threw).toBe(true);
        });

        await it('returns false from owns when there is no provider', async () => {
            clearProviders();
            resetEntitlementCache();
            const result = await owns('pro');
            expect(result).toBe(false);
        });
    });
};
