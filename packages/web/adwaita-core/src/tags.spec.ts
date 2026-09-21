// `hostTagOf` got wrong (`GtkGLArea` -> `gtk-glarea` instead of `gtk-gl-area`), so it is
// pinned by `HOST_TAG_VECTORS`/`ATTRIBUTE_OF_VECTORS` (conformance/tags.ts) rather than
// trusted from the docstring — the same table `adwaita-web`'s own suite drives against real
// DOM. `scripts/check-tag-case-rules.mjs` holds the `scripts/` restatement of both functions
// identical to this module; this suite is what pins the ALGORITHM itself, on Node as well as
// GJS.

import { describe, expect, it } from '@gjsify/unit';

import { ATTRIBUTE_OF_VECTORS, HOST_TAG_VECTORS } from './conformance/tags.js';
import { attributeOf, hostTagOf } from './tags.js';

export default async () => {
    await describe('hostTagOf (conformance vectors)', async () => {
        for (const vector of HOST_TAG_VECTORS) {
            await it(`${vector.gtype || '(empty)'} — ${vector.rule}`, () => {
                if (vector.error !== undefined) {
                    let caught: unknown;
                    try {
                        hostTagOf(vector.gtype);
                    } catch (error) {
                        caught = error;
                    }
                    expect(caught instanceof Error ? caught.message : undefined).toBe(vector.error);
                    return;
                }
                expect(hostTagOf(vector.gtype)).toBe(vector.expected);
            });
        }
    });

    await describe('attributeOf (conformance vectors)', async () => {
        for (const vector of ATTRIBUTE_OF_VECTORS) {
            await it(`${vector.prop || '(empty)'} — ${vector.rule}`, () => {
                expect(attributeOf(vector.prop)).toBe(vector.expected);
            });
        }
    });
};
