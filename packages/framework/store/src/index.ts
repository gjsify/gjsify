// @gjsify/store — store purchase and entitlement interface (ADR 0139 step 3).
// Pure TypeScript; runs identically on GJS, Node and in a browser.

export * from './types.js';
export * from './errors.js';
export { registerProvider, getProvider, clearProviders } from './registry.js';
export { unavailableProvider, UNAVAILABLE_PROVIDER_ID } from './unavailable.js';
export { registerCatalog, getCatalog, productsForCommerce, validateCatalog } from './catalog.js';
export {
    createEntitlementCache,
    getEntitlementCache,
    resetEntitlementCache,
    owns,
    type EntitlementCache,
    type EntitlementCacheStorage,
} from './entitlements.js';
export { resolveSupport, supportPath } from './support.js';
