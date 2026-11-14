import { describe, expect, it } from '@gjsify/unit';
import type Xdp from 'gi://Xdp?version=1.0';

import { AUTOSTART_FLAG } from './wish.js';
import { BackgroundFlags as StubFlags } from './stub.js';

async function loadXdp(): Promise<typeof Xdp | undefined> {
    try {
        return (await import('gi://Xdp?version=1.0')).default;
    } catch {
        return undefined;
    }
}

export default async () => {
    const Xdp = (await loadXdp())!;
    const absent = Xdp === undefined;
    const typelibIt = (name: string, test: () => Promise<void>) =>
        it.failing(name, test, 'the libportal typelib is not installed on this host', { when: absent });
    await describe('flag values against the typelib', async () => {
        await typelibIt('AUTOSTART_FLAG equals Xdp.BackgroundFlags.AUTOSTART', async () => {
            expect(AUTOSTART_FLAG).toBe(Xdp.BackgroundFlags.AUTOSTART);
        });
        await typelibIt('the stub flags equal the typelib values', async () => {
            expect(StubFlags.AUTOSTART).toBe(Xdp.BackgroundFlags.AUTOSTART);
            expect(StubFlags.ACTIVATABLE).toBe(Xdp.BackgroundFlags.ACTIVATABLE);
            expect(StubFlags.NONE).toBe(Xdp.BackgroundFlags.NONE);
        });
    });
};
