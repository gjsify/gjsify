// The real connector against a session bus that is not there (`test:gjs` points it at a dead path).

import { describe, expect, it } from '@gjsify/unit';

import { connectSessionBus } from './dbus-gio.js';

export default async () => {
    await describe('D-Bus connector', async () => {
        await it('answers undefined, not an exception, when the session bus is unreachable', async () => {
            expect(await connectSessionBus(1_000)).toBeUndefined();
        });
    });
};
