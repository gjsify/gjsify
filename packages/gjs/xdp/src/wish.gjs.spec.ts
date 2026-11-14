import { describe, expect, it } from '@gjsify/unit';
import Xdp from 'gi://Xdp?version=1.0';

import { AUTOSTART_FLAG } from './wish.js';
import { BackgroundFlags as StubFlags } from './stub.js';

export default async () => {
    await describe('flag values against the typelib', async () => {
        await it('AUTOSTART_FLAG equals Xdp.BackgroundFlags.AUTOSTART', async () => {
            expect(AUTOSTART_FLAG).toBe(Xdp.BackgroundFlags.AUTOSTART);
        });
        await it('the stub flags equal the typelib values', async () => {
            expect(StubFlags.AUTOSTART).toBe(Xdp.BackgroundFlags.AUTOSTART);
            expect(StubFlags.ACTIVATABLE).toBe(Xdp.BackgroundFlags.ACTIVATABLE);
            expect(StubFlags.NONE).toBe(Xdp.BackgroundFlags.NONE);
        });
    });
};
