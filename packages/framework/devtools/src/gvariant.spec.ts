// @gjsify/devtools — variantKindFor marshalling tests (GJS).
// GI-only: the module imports `gi://GLib?version=2.0`, so it needs a GI host — which
// is GJS or Node with `@gjsify/node-gi`, not GJS alone.

import { describe, expect, it } from '@gjsify/unit';
import { variantKindFor } from './gvariant.js';

export default async () => {
    await describe('variantKindFor — declared type wins', async () => {
        await it('honours a known declared scalar type over the JS value', async () => {
            expect(variantKindFor('s', 123)).toBe('s');
            expect(variantKindFor('b', 'x')).toBe('b');
            expect(variantKindFor('i', 1.5)).toBe('i');
            expect(variantKindFor('u', 0)).toBe('u');
            expect(variantKindFor('d', 1)).toBe('d');
        });
    });

    await describe('variantKindFor — inferred from JS value', async () => {
        await it('maps each JS scalar to a variant kind', async () => {
            expect(variantKindFor(null, 'hi')).toBe('s');
            expect(variantKindFor(null, true)).toBe('b');
            expect(variantKindFor(null, 7)).toBe('i');
            expect(variantKindFor(null, 7.5)).toBe('d');
        });

        await it('throws on an unmarshalable value', async () => {
            expect(() => variantKindFor(null, {})).toThrow();
            expect(() => variantKindFor(null, undefined)).toThrow();
        });
    });
};
