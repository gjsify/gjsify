// @gjsify/distribution — pure TS, runs on Node and GJS. No define is set in the test bundle, so the
// build under test is the `unknown` one; the table and parser are held directly.

import { describe, expect, it } from '@gjsify/unit';
import {
    CHANNEL_CAPABILITIES,
    DECLARABLE_CHANNELS,
    channel,
    donationsAllowed,
    donationsAllowedFor,
    parseChannel,
} from './index.js';

export default async () => {
    await describe('@gjsify/distribution', async () => {
        await it('reports `unknown` and no donation UI when no channel was defined', async () => {
            expect(channel).toBe('unknown');
            expect(donationsAllowed()).toBe(false);
        });
        await it('allows donations only on the free channels', async () => {
            expect(donationsAllowedFor('flathub')).toBe(true);
            expect(donationsAllowedFor('web')).toBe(true);
            expect(donationsAllowedFor('microsoft-store')).toBe(false);
            expect(donationsAllowedFor('apple-app-store')).toBe(false);
            expect(donationsAllowedFor('unknown')).toBe(false);
        });
        await it('has a capability row for every declarable channel', async () => {
            for (const id of DECLARABLE_CHANNELS) expect(typeof CHANNEL_CAPABILITIES[id].donations).toBe('boolean');
        });
        await it('parses only declarable channels', async () => {
            expect(parseChannel('flathub')).toBe('flathub');
            expect(parseChannel('apple-app-store')).toBe('apple-app-store');
            expect(parseChannel('unknown')).toBeUndefined();
            expect(parseChannel('steam')).toBeUndefined();
            expect(parseChannel(undefined)).toBeUndefined();
        });
    });
};
