import { describe, expect, it } from '@gjsify/unit';

import { AUTOSTART_FLAG, classifyProbeError, outcomeOf, wantsAutostart } from './wish.js';

export default async () => {
    await describe('wantsAutostart', async () => {
        await it('is true with the AUTOSTART bit, alone or with ACTIVATABLE', async () => {
            expect(wantsAutostart(AUTOSTART_FLAG)).toBe(true);
            expect(wantsAutostart(AUTOSTART_FLAG | 2)).toBe(true);
        });
        await it('is false without it: the request is the whole wish', async () => {
            expect(wantsAutostart(0)).toBe(false);
            expect(wantsAutostart(2)).toBe(false);
        });
    });
    await describe('outcomeOf', async () => {
        await it('maps the portal boolean', async () => {
            expect(outcomeOf(true)).toBe('granted');
            expect(outcomeOf(false)).toBe('denied');
        });
    });
    await describe('classifyProbeError', async () => {
        await it('reads "nobody serves it" as absent', async () => {
            for (const name of [
                'org.freedesktop.DBus.Error.ServiceUnknown',
                'org.freedesktop.DBus.Error.NameHasNoOwner',
                'org.freedesktop.DBus.Error.UnknownObject',
                'org.freedesktop.DBus.Error.UnknownInterface',
                'org.freedesktop.DBus.Error.UnknownMethod',
                'org.freedesktop.DBus.Error.UnknownProperty',
            ]) {
                expect(classifyProbeError(name)).toBe('absent');
            }
        });
        await it('reads every other answer as broken, never as absent', async () => {
            expect(classifyProbeError('org.freedesktop.DBus.Error.AccessDenied')).toBe('broken');
            expect(classifyProbeError('org.freedesktop.DBus.Error.NoReply')).toBe('broken');
            expect(classifyProbeError(null)).toBe('broken');
        });
    });
};
