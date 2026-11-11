// @gjsify/store/testing — shared fixture suite for any store provider.

import { describe, expect, it } from '@gjsify/unit';
import type { Entitlement, StoreProvider } from '../types.js';
import { StoreConfigError } from '../errors.js';

/** Product ids the shared suite exercises. A provider factory must map each to the named outcome. */
export const SHARED_SUITE_PRODUCTS = {
    purchased: 'outcome.purchased',
    alreadyOwned: 'outcome.already-owned',
    cancelled: 'outcome.cancelled',
    unavailable: 'outcome.unavailable',
    pending: 'outcome.pending',
    unknown: 'outcome.unknown',
} as const;

export interface SharedSuiteOptions {
    /** Factory that creates a fresh provider for each test run. */
    readonly createProvider: () => StoreProvider | Promise<StoreProvider>;
    /** Entitlement the restore fixture is expected to return. */
    readonly restoredEntitlement: Entitlement;
    /** Description shown in test output. */
    readonly label?: string;
}

/**
 * Creates the six-outcome shared fixture suite every app support UI should pass.
 *
 * The factory must return a provider configured so that:
 * - `purchase('outcome.purchased')` returns `{ status: 'purchased' }`,
 * - `purchase('outcome.already-owned')` returns `{ status: 'already-owned' }`,
 * - `purchase('outcome.cancelled')` returns `{ status: 'cancelled' }`,
 * - `purchase('outcome.unavailable')` returns `{ status: 'unavailable' }`,
 * - `purchase('outcome.pending')` returns `{ status: 'pending' }`,
 * - `purchase('outcome.unknown')` throws {@link StoreConfigError},
 * - `restore()` returns at least {@link SharedSuiteOptions.restoredEntitlement}.
 */
export function createStoreSharedSuite(options: SharedSuiteOptions) {
    return async () => {
        await describe(options.label ?? '@gjsify/store shared suite', async () => {
            await it('lists configured products', async () => {
                const provider = await options.createProvider();
                const ids = Object.values(SHARED_SUITE_PRODUCTS).filter((id) => id !== SHARED_SUITE_PRODUCTS.unknown);
                const products = await provider.products(ids);
                expect(products.length).toBe(ids.length);
                for (let i = 0; i < ids.length; i++) {
                    expect(products[i]?.id).toBe(ids[i]);
                }
            });

            await it('returns a purchased entitlement on a successful purchase', async () => {
                const provider = await options.createProvider();
                const result = await provider.purchase(SHARED_SUITE_PRODUCTS.purchased, {});
                expect(result.status).toBe('purchased');
                if (result.status !== 'purchased') return;
                expect(result.entitlement.productId).toBe(SHARED_SUITE_PRODUCTS.purchased);
                expect(typeof result.entitlement.obtainedAt).toBe('string');
            });

            await it('reports an already-owned product', async () => {
                const provider = await options.createProvider();
                const result = await provider.purchase(SHARED_SUITE_PRODUCTS.alreadyOwned, {});
                expect(result.status).toBe('already-owned');
                if (result.status !== 'already-owned') return;
                expect(result.entitlement.productId).toBe(SHARED_SUITE_PRODUCTS.alreadyOwned);
            });

            await it('reports a cancelled purchase as a result, not an exception', async () => {
                const provider = await options.createProvider();
                const result = await provider.purchase(SHARED_SUITE_PRODUCTS.cancelled, {});
                expect(result.status).toBe('cancelled');
            });

            await it('reports an unreachable store as unavailable', async () => {
                const provider = await options.createProvider();
                const result = await provider.purchase(SHARED_SUITE_PRODUCTS.unavailable, {});
                expect(result.status).toBe('unavailable');
                if (result.status !== 'unavailable') return;
                expect(typeof result.reason).toBe('string');
            });

            await it('reports a pending purchase', async () => {
                const provider = await options.createProvider();
                const result = await provider.purchase(SHARED_SUITE_PRODUCTS.pending, {});
                expect(result.status).toBe('pending');
            });

            await it('restores a purchase made on another machine', async () => {
                const provider = await options.createProvider();
                const before = await provider.entitlements();
                const restored = await provider.restore();
                expect(restored.some((e) => e.transactionId === options.restoredEntitlement.transactionId)).toBe(true);
                const after = await provider.entitlements();
                expect(after.length).toBeGreaterThanOrEqual(before.length);
            });

            await it('throws StoreConfigError for an unknown product id', async () => {
                const provider = await options.createProvider();
                let threw = false;
                try {
                    await provider.purchase(SHARED_SUITE_PRODUCTS.unknown, {});
                } catch (error) {
                    threw = error instanceof StoreConfigError;
                }
                expect(threw).toBe(true);
            });
        });
    };
}
