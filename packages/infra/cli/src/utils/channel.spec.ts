import { describe, expect, it } from '@gjsify/unit';
import { channelAllowsDonations, parseDeclaredChannel } from './channel.js';

export default async () => {
    await describe('distribution channel', async () => {
        await it('allows donations on free channels only, and not when unset', async () => {
            expect(channelAllowsDonations('flathub')).toBe(true);
            expect(channelAllowsDonations('web')).toBe(true);
            expect(channelAllowsDonations('microsoft-store')).toBe(false);
            expect(channelAllowsDonations('apple-app-store')).toBe(false);
            expect(channelAllowsDonations(undefined)).toBe(false);
        });
        await it('parses known channels, leaves unset alone, refuses the rest by name', async () => {
            expect(parseDeclaredChannel('web', 'x')).toBe('web');
            expect(parseDeclaredChannel(undefined, 'x')).toBeUndefined();
            expect(() => parseDeclaredChannel('steam', '--channel')).toThrow('Known: flathub');
        });
    });
};
