// The fallback TAIL of both font stacks — the part that decides what a widget set
// looks like on a host that has neither Adwaita face.
//
// THE INCIDENT (#1817)
//
// `--font-family` was `'Adwaita Sans', 'Cantarell', 'Inter', 'Segoe UI', sans-serif`
// and `--monospace-font-family` was `'Adwaita Mono', ui-monospace, 'SF Mono',
// 'Menlo', monospace`. Both are correct on a GNOME desktop and wrong everywhere
// the Adwaita faces are absent, which is everywhere else: neither package ships
// them (see `status/stylesheet-font-families.json`), so a consumer that does not
// call `applyAdwaitaFonts()` reaches the generic. `sans-serif` is Helvetica on
// macOS — the font whose metrics every other platform has moved away from — and
// the monospace generic is Courier New on Windows. Nothing errored; the UI just
// looked borrowed. Found from a consumer's screenshot, which is the only place
// this is visible at all.
//
// READS THE DECLARATION, NOT A COMPUTED FONT
//
// This asserts the SHAPE OF A STACK, not that any family is installed — the
// distinction `adw-fonts.spec.ts` refuses to blur. So it reads the custom
// property off the `:root` rule of the injected `<style>`, which is the authored
// text and byte-identical on every host, rather than
// `getComputedStyle(el).fontFamily`, which resolves against the machine's font
// map. The second would pass or fail depending on which fonts the runner has,
// which is an assertion about the CI image wearing a test's clothes.
//
// The ORDER is asserted, not just membership. `system-ui` after the generic
// family is a stack that is textually present and does nothing, and so is
// `-apple-system` ahead of a `'Segoe UI'` that a Windows host never reaches.
import { describe, expect, it } from '@gjsify/unit';

import '@gjsify/adwaita-web';

/**
 * The declared value of a custom property, read off the stylesheet's own rules.
 *
 * NOT `getComputedStyle`, and not "the first `:root`": the sheet declares `:root`
 * more than once — the generated icon block is one, the light-theme token block is
 * another — and only some of them carry a given token. So every `:root` rule is
 * asked and the first that DECLARES the property answers. The assertion is about
 * the authored text, which is the same on every host.
 */
const declared = (property: string): string => {
    const sheet = (document.getElementById('adwaita-web-style') as HTMLStyleElement | null)?.sheet;
    expect(sheet).not.toBeNull();
    for (let index = 0; index < (sheet as CSSStyleSheet).cssRules.length; index++) {
        const rule = (sheet as CSSStyleSheet).cssRules[index];
        if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ':root') continue;
        const value = rule.style.getPropertyValue(property).trim();
        if (value.length > 0) return value;
    }
    throw new Error(`no :root rule in #adwaita-web-style declares ${property}`);
};

/** The stack's family names, in order, unquoted — a family list split on commas. */
const families = (value: string): string[] =>
    value
        .split(',')
        .map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
        .filter((family) => family.length > 0);

/** Index of `family` in the declared stack, or `-1`. */
const at = (stack: string[], family: string): number => stack.indexOf(family);

export const AdwFontStackTest = async () => {
    await describe('the font fallback tail', async () => {
        await it('names a native face for macOS and Windows before the generic', async () => {
            const stack = families(declared('--font-family'));

            // Every OS's own UI face is reachable, and the generic is LAST — the
            // whole defect was a stack that ended too early for two of the three
            // desktop platforms.
            expect(stack).toContain('system-ui');
            expect(stack).toContain('-apple-system');
            expect(stack).toContain('Segoe UI');
            expect(at(stack, 'system-ui')).toBeGreaterThan(-1);
            expect(at(stack, 'system-ui')).toBeLessThan(stack.length - 1);
            expect(stack[stack.length - 1]).toBe('sans-serif');
        });

        await it('keeps the Adwaita family first, so a GNOME host is unaffected', async () => {
            // The tail was the defect; moving the HEAD would be a different one. On a
            // host that has the face, `system-ui` resolves to the same place and the
            // declaration must not have changed which family wins.
            const stack = families(declared('--font-family'));
            expect(stack[0]).toBe('Adwaita Sans');
            expect(at(stack, 'Adwaita Sans')).toBeLessThan(at(stack, 'system-ui'));
        });

        await it('names Consolas for Windows, where ui-monospace is not supported', async () => {
            // `ui-monospace` is the right way to ask and is NOT universally supported;
            // the engines without it fell straight through to the `monospace` generic,
            // which is Courier New on Windows. Same repair as the sans stack: the
            // platform's own face, named, before the generic.
            const stack = families(declared('--monospace-font-family'));
            expect(stack).toContain('Consolas');
            expect(at(stack, 'Consolas')).toBeLessThan(stack.length - 1);
            expect(stack[stack.length - 1]).toBe('monospace');
            expect(stack[0]).toBe('Adwaita Mono');
        });

        await it('carries the repaired tail into the document stack too', async () => {
            // `.document` text reads `--document-font-family`, which is a `var()` over
            // the base token rather than a stack of its own — so the repair reaches it
            // for free ONLY while it stays a reference. Written out longhand it would
            // be a fourth place to forget, which is the failure this pins.
            expect(declared('--document-font-family')).toBe('var(--font-family)');
        });
    });
};
