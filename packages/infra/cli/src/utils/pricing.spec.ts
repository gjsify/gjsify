import { describe, expect, it } from '@gjsify/unit';
import { parseDeclaredPricing, PRICING_ENV } from './pricing.js';

export default async () => {
    await describe('pricing', async () => {
        await it('only accepts known pricing tiers', async () => {
            expect(parseDeclaredPricing('free', 'test')).toBe('free');
            expect(parseDeclaredPricing('paid', 'test')).toBe('paid');
            expect(parseDeclaredPricing(undefined, 'test')).toBeUndefined();
            expect(parseDeclaredPricing('', 'test')).toBeUndefined();
            expect(() => parseDeclaredPricing('subscription', 'test')).toThrow(
                'test: "subscription" is not a pricing tier',
            );
        });

        await it('exposes the env var name used by gjsify ship', async () => {
            expect(PRICING_ENV).toBe('GJSIFY_PRICING');
        });
    });
};
