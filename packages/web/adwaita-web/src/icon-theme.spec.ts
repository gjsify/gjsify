// The colour half of the icon theme, measured through `getComputedStyle` like
// `icon-registry.spec.ts` measures the symbolic half: a class on the node proves nothing
// about what it paints.
//
// The order under test is GLib's (`g_themed_icon_update_names`, which `GtkImage`'s lookup
// goes through): `X` tries [X, X-symbolic], `X-symbolic` tries [X-symbolic, X], and a name
// neither answers draws `image-missing`. Over the names the order is gtkicontheme.c's: the
// current theme (the stylesheet's glyphs) before hicolor, where a colour registration sits.
// The registry is module-level and outlives a test,
// so every case registers names of its own.
import { describe, expect, it } from '@gjsify/unit';

import { COLOR_ICON_CLASS, type GtkImage } from './elements/gtk-image.js';
import { fallbackMask, maskOf } from './icon-registry.spec.js';
import { isIconAvailable, registerIcon } from './icon-registry.js';
import { registerColorIcon } from './icon-theme.js';

/** A full-colour app icon: a red square on a blue disc, nothing `currentColor` about it. */
const COLOR_SVG = `<svg height="128" viewBox="0 0 128 128" width="128" xmlns="http://www.w3.org/2000/svg">
    <circle cx="64" cy="64" r="60" fill="#3584e4"/>
    <rect x="40" y="40" width="48" height="48" fill="#e01b24"/>
</svg>`;

/** A symbolic glyph, distinct from the colour one by its path data. */
const SYMBOLIC_SVG = `<svg height="16px" viewBox="0 0 16 16" width="16px" xmlns="http://www.w3.org/2000/svg">
    <path d="m 3 3 h 10 v 10 h -10 z m 0 0" fill="currentColor"/>
</svg>`;

function mount(iconName: string): { el: GtkImage; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-image') as GtkImage;
    el.iconName = iconName;
    host.appendChild(el);
    return { el, host };
}

/** Every `.adw-icon--…` mask class on the node. */
function maskClasses(el: HTMLElement): string[] {
    return [...el.classList].filter((c) => c.startsWith('adw-icon--'));
}

/** True when `el` paints the registered colour image and nothing masked. */
function drawsInColor(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return (
        el.classList.contains(COLOR_ICON_CLASS) &&
        maskClasses(el).length === 0 &&
        style.maskImage === 'none' &&
        style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
        // `#e01b24` survives `toDataUri` as `%23e01b24`.
        style.backgroundImage.includes('%23e01b24')
    );
}

export const AdwIconThemeTest = async () => {
    await describe('registerColorIcon — a full-colour icon draws as-is', async () => {
        await it('a reverse-DNS application id draws its image, unmasked and unfilled', () => {
            const APP_ID = 'org.gjsify.ColorProbe';
            registerColorIcon(APP_ID, COLOR_SVG);

            const { el, host } = mount(APP_ID);
            expect(drawsInColor(el)).toBe(true);
            expect(isIconAvailable(APP_ID)).toBe(true);
            host.remove();
        });

        await it('an already-mounted element redraws when the registration lands', () => {
            const APP_ID = 'org.gjsify.LateColorProbe';
            const { el, host } = mount(APP_ID);
            // Before: what GTK draws for a name its theme does not have.
            expect(maskOf(el)).toBe(fallbackMask());

            registerColorIcon(APP_ID, COLOR_SVG);
            expect(drawsInColor(el)).toBe(true);
            host.remove();
        });

        await it("AdwAboutDialog's application-icon draws in colour", () => {
            const APP_ID = 'org.gjsify.AboutColorProbe';
            registerColorIcon(APP_ID, COLOR_SVG);

            const host = document.createElement('div');
            document.body.appendChild(host);
            const dialog = document.createElement('adw-about-dialog');
            dialog.setAttribute('application-icon', APP_ID);
            host.appendChild(dialog);

            const icon = dialog.querySelector('.adw-about-dialog-icon') as HTMLElement;
            expect(drawsInColor(icon)).toBe(true);
            // The 96px box, and NOT a solid square under the image: the about dialog used to
            // force `background-color: currentColor` on it.
            expect(getComputedStyle(icon).width).toBe('96px');
            host.remove();
        });

        await it('a URL source resolves against the document', () => {
            const APP_ID = 'org.gjsify.UrlColorProbe';
            registerColorIcon(APP_ID, 'icons/org.gjsify.UrlColorProbe.svg');

            const { el, host } = mount(APP_ID);
            const expected = new URL('icons/org.gjsify.UrlColorProbe.svg', document.baseURI).href;
            expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(true);
            expect(getComputedStyle(el).backgroundImage).toBe(`url("${expected}")`);
            host.remove();
        });
    });

    await describe('the lookup order is GThemedIcon’s', async () => {
        await it('a symbolic icon still masks — a compiled one with no colour entry', () => {
            const { el, host } = mount('go-next-symbolic');
            expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
            expect(maskClasses(el)).toStrictEqual(['adw-icon--go-next']);
            expect(maskOf(el)).not.toBe(fallbackMask());
            expect(getComputedStyle(el).backgroundImage).toBe('none');
            host.remove();
        });

        await it("the theme's X-symbolic answers X and X-symbolic before the colour X, as on GTK", () => {
            const NAME = 'gjsify-theme-both-probe';
            registerColorIcon(NAME, COLOR_SVG);
            registerIcon(`${NAME}-symbolic`, SYMBOLIC_SVG);

            // gtkicontheme.c `real_choose_icon`: theme outer, name inner, and the colour icon is
            // hicolor's, so the current theme's `X-symbolic` comes first (ADR 0115 Amendment 2).
            const plain = mount(NAME);
            expect(plain.el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
            expect(maskOf(plain.el).includes('m%203%203')).toBe(true);
            plain.host.remove();

            const symbolic = mount(`${NAME}-symbolic`);
            expect(symbolic.el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
            expect(maskOf(symbolic.el).includes('m%203%203')).toBe(true);
            expect(getComputedStyle(symbolic.el).backgroundImage).toBe('none');
            symbolic.host.remove();
        });

        await it('X-symbolic falls back to the colour X, and back again once X-symbolic lands', () => {
            const NAME = 'gjsify-theme-fallback-probe';
            registerColorIcon(NAME, COLOR_SVG);

            const { el, host } = mount(`${NAME}-symbolic`);
            expect(drawsInColor(el)).toBe(true);
            expect(isIconAvailable(`${NAME}-symbolic`)).toBe(true);

            registerIcon(NAME, SYMBOLIC_SVG);
            expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
            expect(maskOf(el).includes('m%203%203')).toBe(true);
            host.remove();
        });

        await it('an unknown name draws image-missing', () => {
            for (const unknown of ['org.gjsify.NeverRegistered', 'gjsify-theme-never-registered']) {
                const { el, host } = mount(unknown);
                expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
                expect(maskOf(el)).toBe(fallbackMask());
                expect(isIconAvailable(unknown)).toBe(false);
                host.remove();
            }
        });
    });

    await describe('registerColorIcon rejects what it cannot draw faithfully', async () => {
        await it('throws on a name that is empty, spaced, or symbolic', () => {
            expect(() => registerColorIcon('', COLOR_SVG)).toThrow();
            expect(() => registerColorIcon('a b', COLOR_SVG)).toThrow();
            // The symbolic half has its own door; GTK's theme treats all three suffixes as
            // symbolic files.
            expect(() => registerColorIcon('gjsify-probe-symbolic', COLOR_SVG)).toThrow();
            expect(() => registerColorIcon('gjsify-probe-symbolic-ltr', COLOR_SVG)).toThrow();
            expect(() => registerColorIcon('gjsify-probe-symbolic-rtl', COLOR_SVG)).toThrow();
        });

        await it('throws on a source that is not SVG or an image URL, and registers nothing', () => {
            const REJECTED = 'org.gjsify.RejectedColorProbe';
            expect(() => registerColorIcon(REJECTED, '')).toThrow();
            expect(() => registerColorIcon(REJECTED, '<p>not svg</p>')).toThrow();
            expect(() => registerColorIcon(REJECTED, 'javascript:alert(1)')).toThrow();
            expect(() => registerColorIcon(REJECTED, 'data:text/html,<svg></svg>')).toThrow();
            expect(isIconAvailable(REJECTED)).toBe(false);

            const { el, host } = mount(REJECTED);
            expect(maskOf(el)).toBe(fallbackMask());
            host.remove();
        });
    });
};
