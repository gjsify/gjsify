// @gjsify/store — product catalog. Step 3 exposes a programmatic API; `gjsify.store.products`
// in package.json is wired by the CLI in a later step.

import type { Commerce, ProductDeclaration } from './types.js';
import { StoreConfigError } from './errors.js';

let registeredCatalog: readonly ProductDeclaration[] = Object.freeze([]);

/** Register the app's product catalog. */
export function registerCatalog(products: readonly ProductDeclaration[]): void {
    validateCatalog(products);
    registeredCatalog = Object.freeze(products.slice());
}

/** The currently registered catalog. */
export function getCatalog(): readonly ProductDeclaration[] {
    return registeredCatalog;
}

/** Products that have a store id for `commerce`. */
export function productsForCommerce(commerce: Commerce): readonly ProductDeclaration[] {
    return registeredCatalog.filter((product) => {
        const storeId = product.stores[commerce];
        return typeof storeId === 'string' && storeId.length > 0;
    });
}

/** Validate a catalog declaration. Throws {@link StoreConfigError} on mistakes. */
export function validateCatalog(products: readonly ProductDeclaration[]): void {
    for (const product of products) {
        if (product.stores.none) {
            throw new StoreConfigError(
                `Product ${product.id} is declared for commerce 'none', which has no store backend`,
            );
        }
        for (const [commerce, storeId] of Object.entries(product.stores)) {
            if (commerce !== 'none' && typeof storeId === 'string' && storeId.length === 0) {
                throw new StoreConfigError(`Product ${product.id} has an empty store id for ${commerce}`);
            }
        }
    }
}
