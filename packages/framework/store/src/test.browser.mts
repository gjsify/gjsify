// Browser test entry. @gjsify/store is pure TS with no platform globals, so the same
// spec runs unchanged in the browser.

import { run } from '@gjsify/unit';

import indexSuite from './index.spec.js';
import { createStoreSharedSuite, MemoryStoreProvider, SHARED_SUITE_PRODUCTS } from './testing/index.js';

const restoredEntitlement = {
    productId: 'pro',
    obtainedAt: '2026-11-08T08:00:00.000Z',
    transactionId: 'txn-pro-other',
};

const sharedSuite = createStoreSharedSuite({
    label: '@gjsify/store/testing against MemoryStoreProvider (browser)',
    createProvider: () =>
        new MemoryStoreProvider({
            id: 'microsoft',
            products: [
                { id: SHARED_SUITE_PRODUCTS.purchased, storeId: '9NPURCHASED', kind: 'tip', localizedPrice: '€1.09' },
                {
                    id: SHARED_SUITE_PRODUCTS.alreadyOwned,
                    storeId: '9NALREADY',
                    kind: 'unlock',
                    localizedPrice: '€9.99',
                },
                { id: SHARED_SUITE_PRODUCTS.cancelled, storeId: '9NCANCELLED', kind: 'tip', localizedPrice: '€1.09' },
                {
                    id: SHARED_SUITE_PRODUCTS.unavailable,
                    storeId: '9NUNAVAILABLE',
                    kind: 'tip',
                    localizedPrice: '€1.09',
                },
                { id: SHARED_SUITE_PRODUCTS.pending, storeId: '9NPENDING', kind: 'tip', localizedPrice: '€1.09' },
            ],
            entitlements: [
                {
                    productId: SHARED_SUITE_PRODUCTS.alreadyOwned,
                    obtainedAt: '2026-11-09T10:00:00.000Z',
                    transactionId: 'txn-owned-1',
                },
            ],
            purchaseResults: {
                [SHARED_SUITE_PRODUCTS.purchased]: {
                    status: 'purchased',
                    entitlement: {
                        productId: SHARED_SUITE_PRODUCTS.purchased,
                        obtainedAt: '2026-11-10T12:00:00.000Z',
                        transactionId: 'txn-purchased-1',
                    },
                },
                [SHARED_SUITE_PRODUCTS.alreadyOwned]: {
                    status: 'already-owned',
                    entitlement: {
                        productId: SHARED_SUITE_PRODUCTS.alreadyOwned,
                        obtainedAt: '2026-11-09T10:00:00.000Z',
                        transactionId: 'txn-owned-1',
                    },
                },
                [SHARED_SUITE_PRODUCTS.cancelled]: { status: 'cancelled' },
                [SHARED_SUITE_PRODUCTS.unavailable]: { status: 'unavailable', reason: 'store-error' },
                [SHARED_SUITE_PRODUCTS.pending]: { status: 'pending' },
            },
            restoreEntitlements: [restoredEntitlement],
        }),
    restoredEntitlement,
});

run({
    indexSuite,
    sharedSuite,
});
