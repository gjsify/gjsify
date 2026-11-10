import { describe, expect, it } from '@gjsify/unit';
import { channelAllowsDonations, parseDeclaredChannel } from './channel.js';

export default async () => {
    await describe('channel', async () => {
        await it('only accepts known channels', async () => {
            expect(parseDeclaredChannel('flathub', 'test')).toBe('flathub');
            expect(parseDeclaredChannel(undefined, 'test')).toBeUndefined();
            expect(() => parseDeclaredChannel('steam', 'test')).toThrow('test: "steam" is not a distribution channel');
        });
        await it('allows only external-link channels to show a donation URL', async () => {
            expect(channelAllowsDonations('flathub')).toBe(true);
            expect(channelAllowsDonations('web')).toBe(true);
            expect(channelAllowsDonations('microsoft-store')).toBe(false);
            expect(channelAllowsDonations('apple-app-store')).toBe(false);
            expect(channelAllowsDonations(undefined)).toBe(false);
        });
    });
};
