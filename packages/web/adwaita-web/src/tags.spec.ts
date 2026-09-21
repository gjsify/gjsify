// `hostTagOf`/`attributeOf` (`@gjsify/adwaita-core/tags`) against `HOST_TAG_VECTORS`/
// `ATTRIBUTE_OF_VECTORS` (`@gjsify/adwaita-core/conformance`) — a real `document.createElement`
// and a real `Element#getAttribute`, not the function compared to itself.
//
// `shared-trees.spec.ts` in this same directory calls both functions too, but only to BUILD
// the tree it renders; it checks the result against `hostTagOf`/`attributeOf` called a
// second time on the same input, which is the same function agreeing with itself, not a
// vector. This suite is the one that holds a call to a value nobody derived from calling it.
import { describe, expect, it } from '@gjsify/unit';

import { ATTRIBUTE_OF_VECTORS, HOST_TAG_VECTORS } from '@gjsify/adwaita-core/conformance';
import { attributeOf, hostTagOf } from '@gjsify/adwaita-core/tags';

export const AdwTagsTest = async () => {
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
                const tag = hostTagOf(vector.gtype);
                expect(tag).toBe(vector.expected);
                // A REAL element, not just a string comparison: the browser accepts the
                // produced tag as a custom-element-shaped name and hands one back under it.
                expect(document.createElement(tag).tagName.toLowerCase()).toBe(vector.expected);
            });
        }
    });

    await describe('attributeOf (conformance vectors)', async () => {
        for (const vector of ATTRIBUTE_OF_VECTORS) {
            await it(`${vector.prop || '(empty)'} — ${vector.rule}`, () => {
                expect(attributeOf(vector.prop)).toBe(vector.expected);
                // The empty attribute name is not settable at all (`InvalidCharacterError`),
                // so that row's DOM half stops at the string check above, like the other
                // conformance drivers do for a row their surface cannot reach.
                if (vector.expected === '') return;
                const el = document.createElement('div');
                el.setAttribute(attributeOf(vector.prop), 'x');
                expect(el.getAttribute(vector.expected)).toBe('x');
            });
        }
    });
};
