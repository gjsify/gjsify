// `lengthValue` — a NativeScript length as a number of DIPs. The `{ value, unit }` object is
// what a device answers for `marginLeft` / `minWidth`; `Number()` of it is `NaN`.

import { describe, expect, it } from '@gjsify/unit';

import { lengthValue } from './widgets/ns-length.js';

export default async () => {
    await describe('lengthValue', async () => {
        await it('reads the object a device answers, default zeroLength included', () => {
            expect(lengthValue({ value: 0, unit: 'px' })).toBe(0);
            expect(lengthValue({ value: 12, unit: 'dip' })).toBe(12);
        });

        await it('reads a number and a CSS-ish string', () => {
            expect(lengthValue(8)).toBe(8);
            expect(lengthValue('80px')).toBe(80);
            expect(lengthValue(' 12 ')).toBe(12);
        });

        await it('is null for what is no plain length', () => {
            expect(lengthValue('auto')).toBe(null);
            expect(lengthValue('50%')).toBe(null);
            expect(lengthValue({ value: 50, unit: '%' })).toBe(null);
            expect(lengthValue('')).toBe(null);
            expect(lengthValue(undefined)).toBe(null);
            expect(lengthValue(null)).toBe(null);
            expect(lengthValue(Number.NaN)).toBe(null);
        });
    });
};
