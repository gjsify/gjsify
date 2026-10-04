// DOM-level tests for `<gtk-text>`: the four properties that reach a real mechanism
// (`max-length` in code points, `placeholder-text`, `visibility` as the mask switch,
// `propagate-text-width` as the input's own `size`) and the `.read-only` node class the C
// toggles with `editable`.
//
// `Gtk.Text` has two BOOLEAN pspecs that default TRUE (`editable`, `visibility`), which is
// why they are read from a value and not from presence: a bare `visibility` attribute would
// say the same as leaving it off. Those are the rows below that would fail for an element
// that used `hasAttribute`.

import { describe, expect, it } from '@gjsify/unit';

import type { GtkText } from './elements/gtk-text.js';

function mount(attrs: Record<string, string> = {}): GtkText {
    const el = document.createElement('gtk-text') as GtkText;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    document.body.appendChild(el);
    return el;
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-text'))) el.remove();
}

/** What a keydown reaches the inner input with — the browser does not dispatch one for a test. */
function pressEnter(input: HTMLInputElement): void {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

export const GtkTextTest = async () => {
    await describe('<gtk-text> text', async () => {
        await it('seeds the field from `text` and reports the live value back', () => {
            const el = mount({ text: 'Ada Lovelace' });
            expect(el.text).toBe('Ada Lovelace');
            expect(el.input.value).toBe('Ada Lovelace');
            unmountAll();
        });

        await it('counts its length in CODE POINTS, as the buffer does', () => {
            const el = mount({ text: '🔒é' });
            expect(el.textLength).toBe(2);
            unmountAll();
        });

        await it('fires `activate` on Enter, the signal GTK binds Return to', () => {
            const el = mount({ text: 'notes' });
            const seen: unknown[] = [];
            el.addEventListener('activate', (event) => seen.push((event as CustomEvent).detail));
            pressEnter(el.input);
            expect(seen).toStrictEqual([{ text: 'notes' }]);
            unmountAll();
        });
    });

    await describe('<gtk-text> max length', async () => {
        await it('clamps the seeded text on code points, where `maxlength` would not', () => {
            const el = mount({ text: '🔒éééé', 'max-length': '3' });
            expect(el.text).toBe('🔒éé');
            expect(el.textLength).toBe(3);
            unmountAll();
        });

        await it('clamps what is typed, not only what is assigned', () => {
            const el = mount({ 'max-length': '4' });
            el.input.value = 'abcdefgh';
            el.input.dispatchEvent(new Event('input', { bubbles: true }));
            expect(el.input.value).toBe('abcd');
            unmountAll();
        });

        await it('0 means unlimited', () => {
            const el = mount({ text: 'a long value' });
            el.maxLength = 0;
            expect(el.maxLength).toBe(0);
            el.text = 'another long value';
            expect(el.text).toBe('another long value');
            unmountAll();
        });
    });

    await describe('<gtk-text> visibility', async () => {
        await it('defaults TRUE, and the pspec default is what an absent attribute means', () => {
            const el = mount();
            expect(el.visibility).toBe(true);
            expect(el.input.type).toBe('text');
            unmountAll();
        });

        await it('`visibility="false"` masks the field; a bare attribute does not', () => {
            const masked = mount({ visibility: 'false' });
            expect(masked.visibility).toBe(false);
            expect(masked.input.type).toBe('password');
            const bare = mount({ visibility: '' });
            expect(bare.visibility).toBe(true);
            expect(bare.input.type).toBe('text');
            unmountAll();
        });

        await it('follows the property and leaves the default unwritten', () => {
            const el = mount();
            el.visibility = false;
            expect(el.getAttribute('visibility')).toBe('false');
            expect(el.input.type).toBe('password');
            el.visibility = true;
            expect(el.hasAttribute('visibility')).toBe(false);
            expect(el.input.type).toBe('text');
            unmountAll();
        });
    });

    await describe('<gtk-text> editable', async () => {
        await it("wears libadwaita's `.read-only` node class when it cannot be changed", () => {
            const el = mount();
            expect(el.editable).toBe(true);
            expect(el.classList.contains('read-only')).toBe(false);
            el.editable = false;
            expect(el.classList.contains('read-only')).toBe(true);
            expect(el.input.readOnly).toBe(true);
            unmountAll();
        });

        await it('takes `editable="false"` as the value the default-TRUE pspec needs', () => {
            const el = mount({ editable: 'false' });
            expect(el.editable).toBe(false);
            expect(el.input.readOnly).toBe(true);
            unmountAll();
        });
    });

    await describe('<gtk-text> propagate text width', async () => {
        await it('sizes the field to its text while set, and stops on request', () => {
            const el = mount({ text: 'abc' });
            el.propagateTextWidth = true;
            expect(el.classList.contains('propagate-text-width')).toBe(true);
            expect(el.input.size).toBe(3);
            el.text = 'abcdefgh';
            expect(el.input.size).toBe(8);
            el.propagateTextWidth = false;
            expect(el.classList.contains('propagate-text-width')).toBe(false);
            unmountAll();
        });

        await it('stays inside its container', () => {
            const el = mount({ text: 'abc', 'propagate-text-width': '' });
            expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(document.body.clientWidth);
            unmountAll();
        });
    });

    await describe('<gtk-text> look', async () => {
        await it('paints the view colours libadwaita gives a `text` node', () => {
            const el = mount();
            const style = getComputedStyle(el.input);
            // `caret-color: currentColor` (_entries.scss:11) resolves against the element's
            // own colour, and the tokens move with the OS theme — so the row compares two
            // computed values instead of naming either of them.
            expect(style.caretColor).toBe(getComputedStyle(el).color);
            expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
            unmountAll();
        });
    });
};
