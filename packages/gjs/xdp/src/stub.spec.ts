import { describe, expect, it } from '@gjsify/unit';

import { BackgroundFlags, createStub } from './stub.js';

export default async () => {
    await describe('named throwing stub', async () => {
        const stub = createStub('browser');
        await it('keeps the flag values real', async () => {
            expect(BackgroundFlags.AUTOSTART).toBe(1);
            expect(BackgroundFlags.ACTIVATABLE).toBe(2);
        });
        await it('throws ENOTSUP naming the member and the runtime', async () => {
            let error: (Error & { code?: string }) | undefined;
            try {
                stub.requestBackground();
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.code).toBe('ENOTSUP');
            expect(error?.message.includes('requestBackground')).toBe(true);
            expect(error?.message.includes('browser')).toBe(true);
        });
        await it('throws on construction of Portal', async () => {
            expect(() => new stub.Portal()).toThrow();
        });
        await it('answers parent_new_gtk with null', async () => {
            expect(stub.XdpGtk4.parent_new_gtk({})).toBe(null);
        });
    });
};
