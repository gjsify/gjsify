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
// nothing. So every assertion that has to be HOST-PROOF reads `document.fonts`
// (the FontFaceSet) or the `CSSFontFaceRule`s of the injected sheet, and a
// system-installed family appears in NEITHER: only faces this document
// registered are there.
//
// ONE case is deliberately not host-proof and says so at the call site: "renders
// distinct bolds" measures rendered WIDTHS, because whether the shipped bytes
// carry a `wght` axis is invisible from the declaration. Its discriminator is
// the `face.weight` assertion beside it, which fontconfig cannot satisfy.
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
    // Indexed, not spread: `cssRules` is a LIVE list, and `unicorn/no-useless-spread`
    // is right that copying it to iterate buys nothing.
    for (let index = 0; index < sheet.cssRules.length; index++) {
        const rule = sheet.cssRules[index];
        if (rule instanceof CSSFontFaceRule) out.push(rule);
    }
    return out;
};

/** The `<style>` element carrying an id, or `null`. */
const sheetOf = (id: string): CSSStyleSheet | null => {
    const element = document.getElementById(id) as HTMLStyleElement | null;
    return element?.sheet ?? null;
};

/** Rendered width of a fixed string in `FAMILY` at `weight`, at a size that makes the difference readable. */
const widthAt = (weight: number): number => {
    const span = document.createElement('span');
    span.style.cssText = `position:absolute;white-space:pre;font-size:64px;font-family:'${FAMILY}';font-weight:${weight}`;
    span.textContent = 'Hamburgefonstiv';
    document.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return width;
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
            // 2.39 MB / 1.18 MB gzip against a 190 KB / 26 KB stylesheet, and
            // `--app browser` has no code splitting, so a lazy face costs the same
            // bytes as an eager one. If that trade is ever revisited (a subsetted
            // woff2 would change it), this assertion is where the decision is
            // recorded and has to be re-argued.
            const sheet = sheetOf('adwaita-web-style');
            expect(sheet).not.toBeNull();
            expect(fontFaceRules(sheet as CSSStyleSheet).length).toBe(0);
        });
    });

    // The removal below is an INVARIANT of this suite, not tidiness: a registered
    // webface changes text METRICS for every element in the document, and this
    // package's suite is full of layout assertions that measure text —
    // `<adw-header-bar>`'s "ellipsizes instead of painting the title over the
    // buttons" is one, and it went red in a discriminator run where the face 404'd
    // mid-suite. `finally` is what MAKES it hold: it runs whether the body threw or
    // not, so the cleanup no longer depends on the last case being reached, on it
    // staying last, or on this suite staying last in `test.browser.mts`. The
    // `it('leaves the document as it found it')` inside states the invariant; this
    // guarantees it.
    try {
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
                // The RANGE, not `400`. Both TTFs are variable fonts (`fvar`:
                // wght 100-900), and a face declared `font-weight: 400` pins the
                // axis there and leaves the engine to synthesise every bolder
                // weight — while `dist/adwaita-web.css` asks for 700 at 27
                // declarations and 800 at 6. Host-proof: a system-installed face
                // never appears in `document.fonts`, so fontconfig cannot satisfy
                // this even on a GNOME desktop.
                for (const face of faces) expect(face.weight).toBe('100 900');
            });

            await it('the faces are self-contained data: URIs, not a relative url()', async () => {
                // The half a `@font-face` COUNT cannot see. Keeping the string alive
                // is not enough: `src: url('./files/adwaita-sans-400.ttf')` resolves
                // against the DOCUMENT, and a `--app browser` build emits one file
                // and no assets, so that rule parses and then 404s.
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

            await it('renders distinct bolds rather than one synthesised weight', async () => {
                // What the declaration alone cannot prove: that the shipped BYTES
                // really carry a `wght` axis. A face clamped to one weight leaves the
                // engine to fake every bold, and a fake is one stroke-widening applied
                // to the same outlines — so 700 and 800 come out PIXEL-IDENTICAL
                // (measured on the clamp: 499.683 px for both, against 517.767 /
                // 533.283 with the range). Comparing 400 against 700 would NOT see
                // that; a synthetic bold is wider than regular too.
                //
                // This one reads the rendered EFFECT, so unlike the assertions above
                // it is not by itself host-proof — a fontconfig-supplied variable
                // Adwaita Sans would also give three widths. Its discriminator is the
                // `face.weight` assertion above, which fontconfig can never satisfy.
                await document.fonts.load(`700 64px '${FAMILY}'`);
                await document.fonts.load(`800 64px '${FAMILY}'`);
                expect(widthAt(700)).not.toBe(widthAt(800));
            });

            await it('is idempotent — a second call neither injects nor duplicates', async () => {
                expect(applyAdwaitaFonts()).toBe(false);
                expect(registeredFaces().length).toBe(2);
            });

            await it('leaves the document as it found it', async () => {
                document.getElementById(ADWAITA_FONTS_STYLE_ID)?.remove();
                expect(registeredFaces().length).toBe(0);
            });
        });
    } finally {
        document.getElementById(ADWAITA_FONTS_STYLE_ID)?.remove();
    }
};
