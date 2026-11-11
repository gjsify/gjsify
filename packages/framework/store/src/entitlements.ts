// @gjsify/store — entitlement cache and ownership queries.

import { channel, CHANNEL_CAPABILITIES, type Commerce } from '@gjsify/distribution';
import { getProvider } from './registry.js';
import { unavailableProvider } from './unavailable.js';
import type { Entitlement } from './types.js';

/** Pluggable persistence for the entitlement cache. */
export interface EntitlementCacheStorage {
    load(): Promise<readonly Entitlement[]> | readonly Entitlement[];
    save(entitlements: readonly Entitlement[]): Promise<void> | void;
}

/** The entitlement cache. */
export interface EntitlementCache {
    has(productId: string): Promise<boolean>;
    get(productId: string): Promise<Entitlement | undefined>;
    set(entitlement: Entitlement): Promise<void>;
    setMany(entitlements: readonly Entitlement[]): Promise<void>;
    all(): Promise<readonly Entitlement[]>;
}

class InMemoryStorage implements EntitlementCacheStorage {
    private entitlements: Entitlement[] = [];

    load(): readonly Entitlement[] {
        return this.entitlements.slice();
    }

    save(entitlements: readonly Entitlement[]): void {
        this.entitlements = entitlements.slice();
    }
}

class EntitlementCacheImpl implements EntitlementCache {
    private readonly storage: EntitlementCacheStorage;
    private readonly cache = new Map<string, Entitlement>();
    private loaded = false;

    constructor(storage: EntitlementCacheStorage) {
        this.storage = storage;
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        const entitlements = await this.storage.load();
        for (const entitlement of entitlements) {
            this.cache.set(entitlement.productId, entitlement);
        }
        this.loaded = true;
    }

    private async flush(): Promise<void> {
        await this.storage.save([...this.cache.values()]);
    }

    async has(productId: string): Promise<boolean> {
        await this.ensureLoaded();
        return this.cache.has(productId);
    }

    async get(productId: string): Promise<Entitlement | undefined> {
        await this.ensureLoaded();
        return this.cache.get(productId);
    }

    async set(entitlement: Entitlement): Promise<void> {
        await this.ensureLoaded();
        this.cache.set(entitlement.productId, entitlement);
        await this.flush();
    }

    async setMany(entitlements: readonly Entitlement[]): Promise<void> {
        await this.ensureLoaded();
        for (const entitlement of entitlements) {
            this.cache.set(entitlement.productId, entitlement);
        }
        await this.flush();
    }

    async all(): Promise<readonly Entitlement[]> {
        await this.ensureLoaded();
        return [...this.cache.values()];
    }
}

let defaultCache: EntitlementCache | undefined;

/** Create a new entitlement cache backed by `storage` (in-memory by default). */
export function createEntitlementCache(storage?: EntitlementCacheStorage): EntitlementCache {
    return new EntitlementCacheImpl(storage ?? new InMemoryStorage()) as EntitlementCache;
}

/** The process-wide default cache. */
export function getEntitlementCache(storage?: EntitlementCacheStorage): EntitlementCache {
    if (!defaultCache) {
        defaultCache = createEntitlementCache(storage);
    }
    return defaultCache;
}

/** Reset the default cache. Mainly for tests. */
export function resetEntitlementCache(): void {
    defaultCache = undefined;
}

function commerceForChannel(): Commerce {
    return CHANNEL_CAPABILITIES[channel].commerce;
}

/**
 * Whether the current user owns `productId`. Uses the entitlement cache first, then the registered
 * provider for the current channel's commerce backend.
 */
export async function owns(productId: string): Promise<boolean> {
    const cache = getEntitlementCache();
    if (await cache.has(productId)) {
        return true;
    }
    const commerce = commerceForChannel();
    const provider = getProvider(commerce) ?? unavailableProvider;
    const entitlements = await provider.entitlements();
    await cache.setMany(entitlements);
    return entitlements.some((entitlement) => entitlement.productId === productId);
}
