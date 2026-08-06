import { describe, it, expect } from '@gjsify/unit';
import { activateNativePrebuilds } from './gi-search-path.js';

/**
 * The GJS behaviour — that a prebuild really becomes loadable without the
 * launcher — is proven where GJS runs, by `tests/e2e/launcher-free-build/`,
 * which also pins the girepository API spelling this module depends on. What a
 * NODE host can observe is the other half of the contract, and it is the half
 * that would break silently: on Node there is no GIRepository, so activation
 * must be a total no-op rather than a throw. The CLI runs `gjsify build` on
 * Node through the npm `rolldown` crate on every developer machine, so a
 * regression here breaks the common path, not the exotic one.
 */
export default async () => {
    await describe('activateNativePrebuilds', async () => {
        await it('is a no-op on a host with no GIRepository', async () => {
            // `globalThis.imports` is absent off GJS, so the capability probe
            // finds nothing to prepend to and every caller carries on.
            expect(activateNativePrebuilds().length).toBe(0);
        });

        await it('never throws, so a native-load path can call it unguarded', async () => {
            expect(() => activateNativePrebuilds()).not.toThrow();
        });

        await it('is memoized — repeated calls return the same decision', async () => {
            expect(activateNativePrebuilds()).toBe(activateNativePrebuilds());
        });
    });
};
