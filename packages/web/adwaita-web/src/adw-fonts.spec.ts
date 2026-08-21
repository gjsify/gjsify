// Does the Adwaita typeface actually SHIP, or is it only named?
//
// THE INCIDENT
//
// `src/index.ts` opened with `import '@gjsify/adwaita-fonts';` and the comment
// "Registers @font-face (fontsource pattern)". It registered nothing. That
// package's `.` export is `index.css`; under `gjsify build --app browser` the
// css-as-string plugin turns a CSS import into `export default "<css>"`, and a
// SIDE-EFFECT import of a module with no side effect is tree-shaken. Measured on
// 0.41.0: a probe entry whose only statement is that import builds to a 0-byte
// bundle with zero `@font-face`, exit 0. So every gjsify-built browser app using
// this package declared `font-family: 'Adwaita Sans'` and registered no face.
//
// It survived for the package's whole life because the workstation it was
// written on is a GNOME desktop with `adwaita-sans-fonts` installed system-wide
// (24 matching `fc-list` rows). Every screenshot looked right. Every computed
// `font-family` read back `'Adwaita Sans', …`. Both were true of a tree that
// shipped no font.
//
// SO NOTHING HERE MAY READ A COMPUTED FONT
//
// `getComputedStyle(el).fontFamily` returns the DECLARED stack, and
// `document.fonts.check()` answers yes for a face fontconfig supplies. Either
// would pass on this host with the bug fully present — a green test that checked
// nothing. Every assertion below reads `document.fonts` (the FontFaceSet) or the
// `CSSFontFaceRule`s of the injected sheet, and a system-installed family
// appears in NEITHER: only faces this document registered are there. A host that
// happens to have Adwaita Sans installed therefore cannot make any of it pass.
import { describe, expect, it } from '@gjsify/unit';

import '@gjsify/adwaita-web';
import { ADWAITA_FONTS_STYLE_ID, applyAdwaitaFonts } from './fonts.js';

const FAMILY = 'Adwaita Sans';

/** Family names round-trip through CSS serialisation, so compare unquoted. */
const unquote = (value: string): string => value.trim().replace(/^['"]|['"]$/g, '');

/** The document-registered faces for `FAMILY` — a system-installed one is never here. */
const registeredFaces = (): FontFace[] => [...document.fonts].filter((face) => unquote(face.family) === FAMILY);

/** Every `@font-face` rule of every same-origin sheet, as `CSSFontFaceRule`s. */
const fontFaceRules = (sheet: CSSStyleSheet): CSSFontFaceRule[] => {
    const out: CSSFontFaceRule[] = [];
    for (const rule of [...sheet.cssRules]) {
        if (rule instanceof CSSFontFaceRule) out.push(rule);
    }
    return out;
};

/** The `<style>` element carrying an id, or `null`. */
const sheetOf = (id: string): CSSStyleSheet | null => {
    const element = document.getElementById(id) as HTMLStyleElement | null;
    return element?.sheet ?? null;
};

export const AdwFontsTest = async () => {
    await describe('the adwaita-web root entry', async () => {
        // THE DISCRIMINATOR for everything below: this runs BEFORE the opt-in, on
        // a host that HAS the family installed. If `registeredFaces()` could be
        // satisfied by fontconfig, this would already be non-empty and the
        // "after" assertions would prove nothing.
        await it('registers no face of its own — the family is only NAMED', async () => {
            expect(registeredFaces().length).toBe(0);
        });

        await it('carries no @font-face in its stylesheet, which is the size decision', async () => {
            // PINNED, not incidental. Inlining the two faces as base64 is
            // 2.58 MB / 1.21 MB gzip against a 190 KB / 26 KB stylesheet, and
            // `--app browser` has no code splitting, so a lazy face costs the same
            // bytes as an eager one. If that trade is ever revisited (a subsetted
            // woff2 would change it), this assertion is where the decision is
            // recorded and has to be re-argued.
            const sheet = sheetOf('adwaita-web-style');
            expect(sheet).not.toBeNull();
            expect(fontFaceRules(sheet as CSSStyleSheet).length).toBe(0);
        });
    });

    await describe('applyAdwaitaFonts', async () => {
        await it('registers both shipped faces in document.fonts', async () => {
            expect(applyAdwaitaFonts()).toBe(true);

            const faces = registeredFaces();
            expect(faces.length).toBe(2);
            expect(
                faces
                    .map((face) => face.style)
                    .sort()
                    .join(','),
            ).toBe('italic,normal');
            for (const face of faces) expect(face.weight).toBe('400');
        });

        await it('the faces are self-contained data: URIs, not a relative url()', async () => {
            // The half a `@font-face` COUNT cannot see. Keeping the string alive is
            // not enough: `src: url('./files/adwaita-sans-400.ttf')` resolves
            // against the DOCUMENT, and a `--app browser` build emits one file and
            // no assets, so that rule parses and then 404s.
            const sheet = sheetOf(ADWAITA_FONTS_STYLE_ID);
            expect(sheet).not.toBeNull();
            const rules = fontFaceRules(sheet as CSSStyleSheet);
            expect(rules.length).toBe(2);
            for (const rule of rules) {
                expect(unquote(rule.style.getPropertyValue('font-family'))).toBe(FAMILY);
                expect(rule.style.getPropertyValue('src')).toContain('data:font/ttf;base64,');
                expect(rule.style.getPropertyValue('src')).not.toContain('./files/');
            }
        });

        await it('the engine can LOAD the registered face, not merely see the rule', async () => {
            // The effect, not the state. A `@font-face` whose payload the engine
            // cannot parse sits in `document.fonts` with `status: "error"`, and a
            // rule-count assertion is happy with it.
            const loaded = await document.fonts.load(`400 16px '${FAMILY}'`);
            expect(loaded.length).toBeGreaterThan(0);
            for (const face of loaded) expect(face.status).toBe('loaded');
        });

        await it('is idempotent — a second call neither injects nor duplicates', async () => {
            expect(applyAdwaitaFonts()).toBe(false);
            expect(registeredFaces().length).toBe(2);
        });

        await it('leaves the document as it found it', async () => {
            // NOT tidiness. A registered webface changes text METRICS for every
            // element in the document, and this package's suite is full of layout
            // assertions that measure text — `<adw-header-bar>`'s "ellipsizes
            // instead of painting the title over the buttons" is one, and it went
            // red in a discriminator run where the face 404'd mid-suite. So the
            // faces are removed again, and this suite is registered LAST in
            // `test.browser.mts` for the same reason: nothing that measures text
            // may run while they are swapping in.
            document.getElementById(ADWAITA_FONTS_STYLE_ID)?.remove();
            expect(registeredFaces().length).toBe(0);
        });
    });
};
