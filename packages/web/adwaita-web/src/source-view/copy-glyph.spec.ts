// The copy glyph the `<adw-source-view>` copy button draws.
//
// The regression this holds: the glyph WAS a constant SVG string assigned with
// `innerHTML`. Constant and safe-until-edited, and the reviewer who flagged the two
// `use-markup` sinks in the same package flagged the shape, so it is built from nodes now.
// These rows are the ones a re-parsing implementation would fail: the namespace, the
// element names, and that nothing about it arrives as a string the browser parsed.

import { describe, expect, it } from '@gjsify/unit';

import { createCopyGlyph } from './copy-glyph.js';

export const CopyGlyphTest = async () => {
    await describe('createCopyGlyph — the copy button still has its icon', async () => {
        await it('is an <svg> in the SVG namespace, sized and viewBox-ed like every other glyph', () => {
            const glyph = createCopyGlyph();
            expect(glyph.namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(glyph.tagName).toBe('svg');
            expect(glyph.getAttribute('width')).toBe('16');
            expect(glyph.getAttribute('height')).toBe('16');
            expect(glyph.getAttribute('viewBox')).toBe('0 0 16 16');
            // The button owns the accessible name; the glyph is decoration inside it.
            expect(glyph.getAttribute('aria-hidden')).toBe('true');
            expect(glyph.getAttribute('fill')).toBe('currentColor');
        });

        await it('draws the two sheets as <path> elements, each with a real outline', () => {
            const glyph = createCopyGlyph();
            const paths = [...glyph.children];
            expect(paths.map((el) => el.tagName)).toStrictEqual(['path', 'path']);
            for (const path of paths) {
                expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
                expect((path.getAttribute('d') ?? '').length).toBeGreaterThan(10);
            }
        });

        await it('lands in a button as a drawable glyph', () => {
            const button = document.createElement('button');
            document.body.appendChild(button);
            button.replaceChildren(createCopyGlyph(button.ownerDocument));
            expect(button.querySelector('svg')).not.toBe(null);
            expect(button.getBoundingClientRect().height).toBeGreaterThan(0);
            button.remove();
        });
    });
};
