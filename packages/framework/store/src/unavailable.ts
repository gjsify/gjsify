// @gjsify/store — the default provider when nothing is registered.

import type { Commerce, Entitlement, PurchaseContext, PurchaseResult, StoreProduct, StoreProvider } from './types.js';

/** The commerce value used by the fallback provider. */
export const UNAVAILABLE_PROVIDER_ID: Commerce = 'none';

/**
 * Fallback provider. It answers `unavailable` and empty entitlements, so an app that has no real
 * store backend stays quiet rather than crashing.
 */
export const unavailableProvider: StoreProvider = {
    id: UNAVAILABLE_PROVIDER_ID,
    async products(): Promise<readonly StoreProduct[]> {
        return [];
    },
    async purchase(_id: string, _ctx: PurchaseContext): Promise<PurchaseResult> {
        return { status: 'unavailable', reason: 'not-registered' };
    },
    async entitlements(): Promise<readonly Entitlement[]> {
        return [];
    },
    async restore(): Promise<readonly Entitlement[]> {
        return [];
    },
};
