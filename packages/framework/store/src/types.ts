// @gjsify/store — shared vocabulary for in-app purchases and entitlements.
// Pure TypeScript; no platform imports.

import type { Commerce } from '@gjsify/distribution';

export type { Commerce } from '@gjsify/distribution';

/** What a product is for in the UI. */
export type ProductKind = 'tip' | 'unlock';

/**
 * How a product is mapped in each store console. Per-store ids live in config because they are
 * assigned by Partner Center and App Store Connect; app code only uses {@link ProductDeclaration.id}.
 */
export type StoreIds = Partial<Record<Commerce, string>>;

/** A product the app offers, declared in `gjsify.store.products`. */
export interface ProductDeclaration {
    /** The app's own name for the product; the only string used in app code. */
    readonly id: string;
    readonly kind: ProductKind;
    /** Per-store product/add-on identifiers. */
    readonly stores: StoreIds;
}

/** A product as the running store provider reports it, including localised price data. */
export interface StoreProduct {
    /** The app's own product id. */
    readonly id: string;
    readonly kind: ProductKind;
    /** The store's identifier for this product. */
    readonly storeId: string;
    /** Localised price string from the store, if available. */
    readonly localizedPrice?: string;
}

/** A right the user has obtained, typically by purchase. */
export interface Entitlement {
    readonly productId: string;
    readonly obtainedAt: string;
    readonly transactionId?: string;
}

/** Window/surface handle the store's native dialog should be modal to. */
export interface PurchaseContext {
    /** The parent window or surface; type is platform-neutral on purpose. */
    readonly parentWindow?: unknown;
}

/** Why a store provider cannot answer right now. */
export type StoreUnavailable = 'not-registered' | 'store-error' | 'network' | 'unknown';

/** The possible outcomes of a purchase call. */
export type PurchaseResult =
    | { readonly status: 'purchased'; readonly entitlement: Entitlement }
    | { readonly status: 'already-owned'; readonly entitlement: Entitlement }
    | { readonly status: 'cancelled' }
    | { readonly status: 'pending' }
    | { readonly status: 'unavailable'; readonly reason: StoreUnavailable };

/** One store backend. */
export interface StoreProvider {
    /** Which commerce backend this provider talks to. */
    readonly id: Commerce;
    /** Load the subset of products the app declares for this provider. */
    products(ids: readonly string[]): Promise<readonly StoreProduct[]>;
    /** Start a purchase flow for `id`. */
    purchase(id: string, ctx: PurchaseContext): Promise<PurchaseResult>;
    /** Current entitlements for this user on this device. */
    entitlements(): Promise<readonly Entitlement[]>;
    /** Pull entitlements from the store, e.g. for a new device. */
    restore(): Promise<readonly Entitlement[]>;
}

/** What {@link resolveSupport} offers when the channel allows store purchases. */
export interface SupportOffer {
    /** The commerce backend that answered. */
    readonly provider: Commerce;
    /** Products available for purchase in this channel. */
    readonly products: readonly StoreProduct[];
}
