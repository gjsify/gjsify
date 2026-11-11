# @gjsify/store

Store purchase and entitlement interface for gjsify apps ([ADR 0139](../../../docs/adr/0139-support-and-purchase-in-stores.md)).
Pure TypeScript, identical on GJS, Node and the browser.

This package does **not** talk to real stores. Native providers (`@gjsify/store-microsoft`,
`@gjsify/store-apple`) are separate packages. `@gjsify/store/testing` ships a scriptable in-memory
provider and a shared fixture suite.

```ts
import { registerCatalog, registerProvider, resolveSupport, owns } from '@gjsify/store';
import { MemoryStoreProvider } from '@gjsify/store/testing';

registerCatalog([
    { id: 'support.small', kind: 'tip', stores: { microsoft: '9NSMALL', apple: 'eu.jumplink.small' } },
]);

registerProvider(
    new MemoryStoreProvider({
        id: 'microsoft',
        products: [{ id: 'support.small', storeId: '9NSMALL', kind: 'tip', localizedPrice: '€1.09' }],
        purchaseResults: {
            'support.small': {
                status: 'purchased',
                entitlement: { productId: 'support.small', obtainedAt: new Date().toISOString() },
            },
        },
    }),
);

const offer = await resolveSupport();
if (offer) {
    console.log(`Support via ${offer.provider}:`, offer.products);
}

if (await owns('support.small')) {
    console.log('User owns the tip product');
}
```

## Provider interface

```ts
export interface StoreProvider {
    readonly id: Commerce;
    products(ids: readonly string[]): Promise<readonly StoreProduct[]>;
    purchase(id: string, ctx: PurchaseContext): Promise<PurchaseResult>;
    entitlements(): Promise<readonly Entitlement[]>;
    restore(): Promise<readonly Entitlement[]>;
}
```

A cancelled purchase returns `{ status: 'cancelled' }`; only programming errors throw
`StoreConfigError`.

## Catalogue

`registerCatalog()` accepts the app's product declarations. Step 3 exposes a programmatic API;
`gjsify.store.products` in `package.json` is wired by the CLI in a later step.

## Entitlements

`owns(id)` consults the entitlement cache first, then the registered provider. The default cache is
in-memory; persistence can be injected via `createEntitlementCache(storage)` or
`getEntitlementCache(storage)`.

## Testing

```ts
import { createStoreSharedSuite, MemoryStoreProvider } from '@gjsify/store/testing';
```

The shared suite exercises the six outcomes (successful purchase, already-owned, cancelled,
unavailable, pending, and cross-device restore) against any `StoreProvider` implementation.
