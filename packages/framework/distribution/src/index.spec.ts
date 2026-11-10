// @gjsify/distribution — pure TS, runs on Node and GJS. The standard test bundle has no defines,
// so the build under test is the `unknown` / `free` one; the `test:*:paid` builds set
// `__GJSIFY_PRICING__` to `'paid'`. The table and parser are held directly.

import { describe, expect, it } from '@gjsify/unit';
import {
    CHANNEL_CAPABILITIES,
    DECLARABLE_CHANNELS,
    type Channel,
    channel,
    donationsAllowed,
    donationsAllowedFor,
    parseChannel,
    pricing,
    purchased,
    purchasedFor,
    supportPath,
    supportPathFor,
} from './index.js';

export default async () => {
    await describe('@gjsify/distribution', async () => {
        await it('reports `unknown` and no support UI when no channel was defined', async () => {
            expect(channel).toBe('unknown');
            expect(supportPath()).toBe('none');
            expect(donationsAllowed()).toBe(false);
            if (pricing() === 'free') {
                expect(pricing()).toBe('free');
                expect(purchased()).toBe(false);
            } else {
                expect(pricing()).toBe('paid');
                expect(purchased()).toBe(true);
            }
        });
        await it('reports the support path for every channel', async () => {
            expect(supportPathFor('flathub')).toBe('external-link');
            expect(supportPathFor('web')).toBe('external-link');
            expect(supportPathFor('microsoft-store')).toBe('none');
            expect(supportPathFor('apple-app-store')).toBe('store-purchase');
            expect(supportPathFor('unknown')).toBe('none');
        });
        await it('keeps the deprecated donation predicate for external-link channels', async () => {
            expect(donationsAllowedFor('flathub')).toBe(true);
            expect(donationsAllowedFor('web')).toBe(true);
            expect(donationsAllowedFor('microsoft-store')).toBe(false);
            expect(donationsAllowedFor('apple-app-store')).toBe(false);
            expect(donationsAllowedFor('unknown')).toBe(false);
        });
        await it('ties the deprecated purchase predicate to pricing, not the channel', async () => {
            if (pricing() === 'free') {
                expect(purchasedFor('microsoft-store')).toBe(false);
                expect(purchasedFor('apple-app-store')).toBe(false);
                expect(purchasedFor('flathub')).toBe(false);
                expect(purchasedFor('web')).toBe(false);
                expect(purchasedFor('unknown')).toBe(false);
                expect(purchased()).toBe(false);
            } else {
                expect(purchasedFor('microsoft-store')).toBe(true);
                expect(purchasedFor('apple-app-store')).toBe(true);
                expect(purchasedFor('flathub')).toBe(true);
                expect(purchasedFor('web')).toBe(true);
                expect(purchasedFor('unknown')).toBe(true);
                expect(purchased()).toBe(true);
            }
        });
        await it('has a capability row for every declarable channel', async () => {
            for (const id of DECLARABLE_CHANNELS) {
                expect(typeof CHANNEL_CAPABILITIES[id].support).toBe('string');
                expect(typeof CHANNEL_CAPABILITIES[id].commerce).toBe('string');
                expect(typeof CHANNEL_CAPABILITIES[id].ownLicensing).toBe('boolean');
            }
        });
        await it('parses only declarable channels', async () => {
            expect(parseChannel('flathub')).toBe('flathub');
            expect(parseChannel('apple-app-store')).toBe('apple-app-store');
            expect(parseChannel('unknown')).toBeUndefined();
            expect(parseChannel('steam')).toBeUndefined();
            expect(parseChannel(undefined)).toBeUndefined();
        });
        await it('exposes the ADR 0139 capability table', async () => {
            const expected: Record<Channel, { support: string; commerce: string; ownLicensing: boolean }> = {
                flathub: { support: 'external-link', commerce: 'none', ownLicensing: true },
                web: { support: 'external-link', commerce: 'none', ownLicensing: true },
                'microsoft-store': { support: 'none', commerce: 'microsoft', ownLicensing: true },
                'apple-app-store': { support: 'store-purchase', commerce: 'apple', ownLicensing: false },
                unknown: { support: 'none', commerce: 'none', ownLicensing: false },
            };
            for (const id of [...DECLARABLE_CHANNELS, 'unknown'] as const) {
                expect(CHANNEL_CAPABILITIES[id].support).toBe(expected[id].support);
                expect(CHANNEL_CAPABILITIES[id].commerce).toBe(expected[id].commerce);
                expect(CHANNEL_CAPABILITIES[id].ownLicensing).toBe(expected[id].ownLicensing);
            }
        });
    });
};
