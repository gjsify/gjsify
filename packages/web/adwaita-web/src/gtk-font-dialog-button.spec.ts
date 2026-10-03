// DOM-level tests for <gtk-font-dialog-button>. The label rules are GTK's and each is
// separate: at `family` it is one word, at `font` it is family plus size, the size box is
// gone below `font`, and `use-font` draws the family label in the selected font — with the
// size only when `use-size` says so.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkFontDialogButton } from './elements/gtk-font-dialog-button.js';

function mount(attrs: Record<string, string> = {}): {
    el: GtkFontDialogButton;
    host: HTMLElement;
    label: HTMLElement;
    sizeBox: HTMLElement;
    sizeLabel: HTMLElement;
    button: HTMLButtonElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-font-dialog-button') as GtkFontDialogButton;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return {
        el,
        host,
        label: el.querySelector('.font-button-label') as HTMLElement,
        sizeBox: el.querySelector('.font-button-size') as HTMLElement,
        sizeLabel: el.querySelector('.font-button-size-label') as HTMLElement,
        button: el.querySelector('button') as HTMLButtonElement,
    };
}

export const GtkFontDialogButtonTest = async () => {
    await describe('<gtk-font-dialog-button> defaults', async () => {
        await it('opens on "Sans 12", the description init builds', () => {
            const { el, host, label, sizeLabel } = mount();
            expect(el.fontDesc.family).toBe('Sans');
            expect(el.fontDesc.size).toBe(12);
            expect(label.textContent).toBe('Sans');
            expect(sizeLabel.textContent).toBe('12');
            host.remove();
        });

        await it('is at level font, so the size box is showing', () => {
            const { el, host, sizeBox } = mount();
            expect(el.level).toBe('font');
            expect(sizeBox.hidden).toBe(false);
            host.remove();
        });

        await it('is insensitive until a dialog is set', () => {
            const { el, host, button } = mount();
            expect(button.disabled).toBe(true);
            el.dialog = {};
            expect(button.disabled).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-font-dialog-button> font-desc', async () => {
        await it('parses Pango’s own string form, styles in any order', () => {
            const { el, host } = mount({ 'font-desc': 'Cantarell Bold Italic 14' });
            expect(el.fontDesc.family).toBe('Cantarell');
            expect(el.fontDesc.weight).toBe(700);
            expect(el.fontDesc.slant).toBe('italic');
            expect(el.fontDesc.size).toBe(14);
            host.remove();
        });

        await it('remembers a size written in pixels, and prints the unit back', () => {
            const { el, host, sizeLabel } = mount({ 'font-desc': 'Cantarell 18px' });
            expect(el.fontDesc.absolute).toBe(true);
            expect(sizeLabel.textContent).toBe('18px');
            host.remove();
        });

        await it('a write of the description already held notifies nothing', () => {
            const { el, host } = mount({ 'font-desc': 'Sans 12' });
            const notified: unknown[] = [];
            el.addEventListener('notify::font-desc', (e) => notified.push((e as CustomEvent).detail));
            el.fontDesc = 'Sans 12';
            expect(notified.length).toBe(0);
            el.fontDesc = 'Sans 14';
            expect(notified.length).toBe(1);
            host.remove();
        });

        await it('a family that was never set reads as the C’s "None"', () => {
            const { el, host, label } = mount();
            el.fontDesc = '12';
            expect(el.fontDesc.family).toBe('');
            expect(label.textContent).toBe('None');
            host.remove();
        });
    });

    await describe('<gtk-font-dialog-button> level', async () => {
        await it('at family the label is the family alone and the size box is gone', () => {
            const { host, label, sizeBox } = mount({ level: 'family', 'font-desc': 'Cantarell 14' });
            expect(label.textContent).toBe('Cantarell');
            expect(sizeBox.hidden).toBe(true);
            host.remove();
        });

        await it('at face the size box is gone but the style words are in the label', () => {
            const { el, host, label, sizeBox } = mount();
            el.fontDesc = 'Cantarell Bold 12';
            el.level = 'face';
            expect(sizeBox.hidden).toBe(true);
            expect(label.textContent).toBe('Cantarell Bold');
            host.remove();
        });

        await it('an unknown level is the default, as an unknown orientation is horizontal', () => {
            const { el, host } = mount();
            el.setAttribute('level', 'glyph');
            expect(el.level).toBe('font');
            host.remove();
        });
    });

    await describe('<gtk-font-dialog-button> use-font', async () => {
        await it('draws the label in the selected font, without the size unless asked', () => {
            const { el, host, label } = mount({ 'font-desc': 'Cantarell Bold 14' });
            expect(label.style.fontFamily).toBe('');
            el.useFont = true;
            expect(label.style.fontWeight).toBe('700');
            expect(label.style.fontFamily).toBe('"Cantarell"');
            // `use-size` is false, so `PANGO_FONT_MASK_SIZE` was cleared and there is no size.
            expect(label.style.fontSize).toBe('');
            el.useSize = true;
            // `pt`, not a bare `14`: Pango's string carries no unit and a CSS length
            // rejects one that does not, so the projection names the unit Pango means.
            expect(label.style.fontSize).toBe('14pt');
            el.useFont = false;
            expect(label.style.fontFamily).toBe('');
            host.remove();
        });

        await it('keeps a size written in pixels in pixels', () => {
            const { host, label } = mount({ 'font-desc': 'Cantarell 18px', 'use-font': '', 'use-size': '' });
            expect(label.style.fontSize).toBe('18px');
            host.remove();
        });

        await it('carries font-features and language into the label with it', () => {
            const { el, host, label } = mount({ 'font-desc': 'Cantarell 12', 'use-font': '', 'use-size': '' });
            el.fontFeatures = 'liga';
            el.language = 'de-de';
            // CSS wants each tag quoted, which is the whole translation Pango's list needs.
            expect(label.style.fontFeatureSettings).toBe('"liga"');
            expect(label.lang).toBe('de-de');
            host.remove();
        });

        await it('keeps the tags a browser knows and drops the ones it does not', () => {
            const { el, host, label } = mount({ 'font-desc': 'Cantarell 12', 'use-font': '', 'use-size': '' });
            // A `font-feature-settings` value is dropped WHOLE when any tag in it is unknown
            // (measured in Firefox: `"liga", "-kern"` stands for nothing, `"liga"` alone
            // does). So the tags are applied one at a time, and one rejection costs one
            // feature rather than all of them.
            el.fontFeatures = 'liga, -kern';
            expect(label.style.fontFeatureSettings).toBe('"liga"');
            host.remove();
        });
    });
};
