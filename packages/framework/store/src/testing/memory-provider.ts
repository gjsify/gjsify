// @gjsify/store/testing — scriptable in-memory store provider for tests.

import { StoreConfigError } from '../errors.js';
import type { Commerce, Entitlement, PurchaseContext, PurchaseResult, StoreProduct, StoreProvider } from '../types.js';

export type PurchaseResultFactory = () => PurchaseResult | Promise<PurchaseResult>;

export interface MemoryStoreProviderOptions {
    /** Commerce backend this provider pretends to be. Defaults to `'microsoft'`. */
    readonly id?: Commerce;
    /** Products this provider answers for. */
    readonly products: readonly StoreProduct[];
    /** Entitlements already held on this device. */
    readonly entitlements?: readonly Entitlement[];
    /** Per-product purchase result. A missing product returns `unavailable`. */
    readonly purchaseResults?: Readonly<Record<string, PurchaseResult | PurchaseResultFactory>>;
    /** Entitlements returned by {@link MemoryStoreProvider.restore}. */
    readonly restoreEntitlements?: readonly Entitlement[];
}

/**
 * A store provider scripted by fixtures. It is the provider every test and CI leg uses, because
 * real store APIs have no simulator.
 */
export class MemoryStoreProvider implements StoreProvider {
    readonly id: Commerce;
    private readonly productsById = new Map<string, StoreProduct>();
    private readonly entitlementMap = new Map<string, Entitlement>();
    private readonly purchaseResults = new Map<string, PurchaseResultFactory>();
    private readonly restoreEntitlements: readonly Entitlement[];

    constructor(options: MemoryStoreProviderOptions) {
        this.id = options.id ?? 'microsoft';
        for (const product of options.products) {
            this.productsById.set(product.id, product);
        }
        for (const entitlement of options.entitlements ?? []) {
            this.entitlementMap.set(entitlement.productId, entitlement);
        }
        for (const [productId, result] of Object.entries(options.purchaseResults ?? {})) {
            this.purchaseResults.set(
                productId,
                typeof result === 'function' ? (result as PurchaseResultFactory) : () => result,
            );
        }
        this.restoreEntitlements = options.restoreEntitlements ?? [];
    }

    async products(ids: readonly string[]): Promise<readonly StoreProduct[]> {
        return ids
            .map((id) => this.productsById.get(id))
            .filter((product): product is StoreProduct => product !== undefined);
    }

    async purchase(id: string, _ctx: PurchaseContext): Promise<PurchaseResult> {
        if (!this.productsById.has(id)) {
            throw new StoreConfigError(`Unknown product id: ${id}`);
        }
        const factory = this.purchaseResults.get(id);
        if (!factory) {
            return { status: 'unavailable', reason: 'unknown' };
        }
        const result = await factory();
        if (result.status === 'purchased' || result.status === 'already-owned') {
            this.entitlementMap.set(id, result.entitlement);
        }
        return result;
    }

    async entitlements(): Promise<readonly Entitlement[]> {
        return [...this.entitlementMap.values()];
    }

    async restore(): Promise<readonly Entitlement[]> {
        for (const entitlement of this.restoreEntitlements) {
            this.entitlementMap.set(entitlement.productId, entitlement);
        }
        return this.restoreEntitlements.slice();
    }
}
