import { describe, it, expect } from '@gjsify/unit';
import { GJS_GI_BACKED_REGISTERS } from '@gjsify/resolve-npm/globals-map';

import { giNamespacesForRegister } from './auto-globals.js';

// Real fixtures, taken from the map the function reads — a hard-coded `pkg/register/foo`
// matches nothing and would pass or fail for the wrong reason. The first GI-backed
// register is stable enough for a test and the granular subpath is a real export
// (`@gjsify/dom-elements` ships `./register/document`, `./register/canvas`, …).
const [SAMPLE] = Object.keys(GJS_GI_BACKED_REGISTERS);

export default async () => {
    await describe('giNamespacesForRegister', async () => {
        await it('matches a register path', () => {
            const result = giNamespacesForRegister(`${SAMPLE}/document`);
            expect(result).not.toBeNull();
        });

        await it('does not match a non-register path', () => {
            const result = giNamespacesForRegister('pkg/other');
            expect(result).toBeNull();
        });

        await it('matches the register path itself', () => {
            const result = giNamespacesForRegister(SAMPLE);
            expect(result).not.toBeNull();
        });
    });
};
