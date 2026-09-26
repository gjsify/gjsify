// `require('fs')` from a bundled CommonJS module must be a mutable object, as it is in
// Node: graceful-fs patches it in place. See cjs-interop.fixture.cjs.

import { describe, it, expect } from '@gjsify/unit';
import cjsInterop from './cjs-interop.fixture.cjs';

export default async () => {
    await describe("fs: require('fs') from CommonJS", async () => {
        await it('can be patched in place, as graceful-fs does', async () => {
            expect(cjsInterop.patched).toBe(true);
            expect(cjsInterop.restored).toBe(true);
            expect(cjsInterop.hasReadFile).toBe(true);
        });
    });
};
