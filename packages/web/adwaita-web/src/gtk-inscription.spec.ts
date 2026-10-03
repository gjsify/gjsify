// DOM-level tests for <gtk-inscription>. Two things dominate and both are about DEFAULTS,
// because GtkInscription's defaults are the opposite of GtkLabel's: `min-chars` is 3 and
// `xalign` is 0 where a label has none and 0.5, and `wrap-mode` defaults to WORD_CHAR where a
// label defaults to WORD. A port that reused the label's defaults would be wrong in a way no
// property assertion would catch, so the first test in each block pins the C's own numbers.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkInscription } from './elements/gtk-inscription.js';

function mount(attrs: Record<string, string> = {}): { el: GtkInscription; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-inscription') as GtkInscription;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

export const GtkInscriptionTest = async () => {
    await describe('<gtk-inscription> defaults', async () => {
        await it('reserves three characters and one line, and nothing more', () => {
            // gtkinscription.c:59-65, :787-790 — min-chars 3, nat-chars 0, min-lines 1,
            // nat-lines 0. So out of the box it holds three characters wide and one line
            // tall, and lets its text be as long as it likes.
            const { el, host } = mount();
            expect(el.minChars).toBe(3);
            expect(el.natChars).toBe(0);
            expect(el.minLines).toBe(1);
            expect(el.natLines).toBe(0);
            host.remove();
        });

        await it('is start-aligned and centre-tall, the opposite pairing to GtkLabel', () => {
            // gtkinscription.c:67-69, :791-792 — xalign 0.0, yalign 0.5. This is what makes a
            // caption left-aligned under a centred icon with no CSS of its own.
            const { el, host } = mount();
            expect(el.xalign).toBe(0);
            expect(el.yalign).toBe(0.5);
            host.remove();
        });

        await it('wraps at WORD_CHAR, where GtkLabel wraps at WORD', () => {
            // gtkinscription.c:738-740 — the pspec says so in its own doc comment, and the
            // reason is the widget's purpose: a box of a known character count has to break
            // a word longer than itself or it overflows.
            const { el, host } = mount();
            expect(el.wrapMode).toBe('word-char');
            expect(getComputedStyle(el).overflowWrap).toBe('anywhere');
            host.remove();
        });

        await it('clips its overflow, where a label only ellipsizes when asked', () => {
            // gtkinscription.c:728-733 — GTK_INSCRIPTION_OVERFLOW_CLIP is the pspec default,
            // so nothing disappears silently without it being written down.
            const { el, host } = mount();
            expect(el.textOverflow).toBe('clip');
            expect(el.classList.contains('clip')).toBe(true);
            expect(el.classList.contains('ellipsized')).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-inscription> the four counts ARE the measure', async () => {
        await it('the natural width is MAX(min, nat) — never the smaller of the two', () => {
            // gtkinscription.c:347-348 — `*natural = MAX (min_chars, nat_chars) * char_pixels`.
            // A nat BELOW the min does not shrink the widget below the minimum it reserved.
            const { el, host } = mount({ 'min-chars': '20', 'nat-chars': '5' });
            expect(el.style.getPropertyValue('--gtk-inscription-width')).toBe('20ch');
            expect(el.style.getPropertyValue('--gtk-inscription-min-ch')).toBe('20ch');
            host.remove();
        });

        await it('a nat ABOVE the min does widen it', () => {
            const { el, host } = mount({ 'min-chars': '5', 'nat-chars': '20' });
            expect(el.style.getPropertyValue('--gtk-inscription-width')).toBe('20ch');
            host.remove();
        });

        await it('both counts at ZERO means the widget does not size itself at all', () => {
            // gtkinscription.c:344-345 and :378-379 — both measures return NOTHING when the
            // two counts are zero, so the minimum is whatever the widget already had. That is
            // NOT `0ch`, which would be a very much smaller widget.
            const { el, host } = mount({ 'min-chars': '0', 'nat-chars': '0' });
            expect(el.style.getPropertyValue('--gtk-inscription-width')).toBe('auto');
            expect(el.style.getPropertyValue('--gtk-inscription-min-ch')).toBe('auto');
            const { el: el2, host: host2 } = mount({ 'min-lines': '0', 'nat-lines': '0' });
            expect(el2.style.getPropertyValue('--gtk-inscription-height')).toBe('auto');
            host.remove();
            host2.remove();
        });

        await it('the line counts use lh, which is the line box Pango measures', () => {
            // gtkinscription.c:383-384 — `min_lines * line_pixels`. CSS `lh` resolves to the
            // element's own line box, which is that unit.
            const { el, host } = mount({ 'min-lines': '2', 'nat-lines': '4' });
            expect(el.style.getPropertyValue('--gtk-inscription-min-lh')).toBe('2lh');
            expect(el.style.getPropertyValue('--gtk-inscription-height')).toBe('4lh');
            host.remove();
        });

        await it('a negative count clamps to zero — there is no -1 "auto" here', () => {
            // gtkinscription.c:638-644 — the pspec is a `guint` with a floor of 0, unlike
            // `GtkLabel:width-chars`, whose floor is -1.
            const { el, host } = mount({ 'min-chars': '-5' });
            expect(el.minChars).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-inscription> wrap-mode and text-overflow', async () => {
        await it('the three wrap nicks reach real CSS, none of them a gap', () => {
            // The same two declarations `_labels.scss:112-126` states for `<gtk-label>`:
            // `word-break: break-all` is Pango's CHAR, `overflow-wrap: anywhere` is
            // WORD_CHAR, and `normal` is WORD — which needs a rule only because
            // WORD_CHAR is THIS widget's default.
            const char = mount({ 'wrap-mode': 'char' });
            expect(getComputedStyle(char.el).wordBreak).toBe('break-all');
            char.host.remove();
            const word = mount({ 'wrap-mode': 'word' });
            expect(getComputedStyle(word.el).overflowWrap).toBe('normal');
            word.host.remove();
            const both = mount({ 'wrap-mode': 'word-char' });
            expect(getComputedStyle(both.el).overflowWrap).toBe('anywhere');
            both.host.remove();
        });

        await it("keeps the GtkInscription nicks, which are not the label's", () => {
            // packages/framework/gtk-host/src/generated/props.ts:331 — `clip`,
            // `ellipsize-start`, `ellipsize-middle`, `ellipsize-end`, where
            // `Gtk.Label:ellipsize` spells the same four `none`/`start`/`middle`/`end`.
            for (const mode of ['clip', 'ellipsize-start', 'ellipsize-middle', 'ellipsize-end'] as const) {
                const { el, host } = mount({ 'text-overflow': mode });
                expect(el.textOverflow).toBe(mode);
                host.remove();
            }
        });

        await it('draws every truncating member as an END ellipsis, which is the divergence', () => {
            // `labelEllipsizeOverflowValue`'s own doc comment: CSS `text-overflow` has one
            // truncating value, so `start` and `middle` are drawn as an end ellipsis — never
            // as a silent clip, which would drop the same characters with no indication.
            const { el, host } = mount({ 'text-overflow': 'ellipsize-middle' });
            expect(el.classList.contains('ellipsized')).toBe(true);
            expect(el.style.getPropertyValue('--gtk-inscription-text-overflow')).toBe('ellipsis');
            host.remove();
        });

        await it('clip stays clip', () => {
            const { el, host } = mount({ 'text-overflow': 'clip' });
            expect(el.style.getPropertyValue('--gtk-inscription-text-overflow')).toBe('clip');
            host.remove();
        });
    });

    await describe('<gtk-inscription> text and markup', async () => {
        await it('text is written as a text node, never as parsed markup', () => {
            // The XSS answer `<gtk-label>` already gives: the string is the display text, not
            // a document. `labelDisplayText` is the same reduction the NativeScript port uses.
            const { el, host } = mount({ text: '<b>bold</b>' });
            expect(el.textContent).toBe('<b>bold</b>');
            expect(el.querySelector('b')).toBe(null);
            host.remove();
        });

        await it('markup is REDUCED to its plain text, not handed to innerHTML', () => {
            const { el, host } = mount({ markup: '<b>bold</b>' });
            expect(el.textContent).toBe('bold');
            expect(el.querySelector('b')).toBe(null);
            host.remove();
        });

        await it('text wins when both are written, which is the order the C leaves them in', () => {
            // `gtk_inscription_set_markup` writes the label directly and a later `set_text`
            // overwrites it, so a tree carrying both reads as the plain one.
            const { el, host } = mount({ text: 'plain', markup: '<b>markup</b>' });
            expect(el.textContent).toBe('plain');
            host.remove();
        });
    });

    await describe('<gtk-inscription> alignment and events', async () => {
        await it('xalign is a ratio on the spacer pair, and 0 puts all free space before', () => {
            // GTK places the text at `xalign * (width − text width)`; splitting the free
            // space between two `flex-grow` spacers in the ratio `xalign : 1 − xalign` IS that
            // formula, and `flex-grow` takes a real number where `align-items` does not.
            const { el, host } = mount({ xalign: '0.25' });
            expect(el.style.getPropertyValue('--gtk-inscription-xalign')).toBe('0.25');
            expect(getComputedStyle(el, '::before').flexGrow).toBe('0.25');
            expect(getComputedStyle(el, '::after').flexGrow).toBe('0.75');
            host.remove();
        });

        await it('a value outside 0…1 is held to the interval, as the pspec range is', () => {
            // gtkinscription.c:757-760 — `g_param_spec_float (…, 0.0, 1.0, …)`.
            const { el, host } = mount({ xalign: '4' });
            expect(el.xalign).toBe(1);
            const low = mount({ yalign: '-2' });
            expect(low.el.yalign).toBe(0);
            host.remove();
            low.host.remove();
        });

        await it('notifies once per real change, with the PARSED property in the detail', () => {
            const { el, host } = mount();
            const events: unknown[] = [];
            el.addEventListener('notify::min-chars', (e) => events.push((e as CustomEvent).detail));
            el.minChars = 12;
            el.minChars = 12;
            el.minChars = 4;
            expect(events).toStrictEqual([{ 'min-chars': 12 }, { 'min-chars': 4 }]);
            host.remove();
        });

        await it('a declaration in the markup is adopted without emitting', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('gtk-inscription') as GtkInscription;
            const events: unknown[] = [];
            el.addEventListener('notify::min-chars', (e) => events.push((e as CustomEvent).detail));
            el.setAttribute('min-chars', '7');
            host.appendChild(el);
            expect(el.minChars).toBe(7);
            expect(events.length).toBe(0);
            host.remove();
        });

        await it('has no ARIA role, because ARIA has no keyword for static text', () => {
            // gtkinscription.c:781 sets GTK_ACCESSIBLE_ROLE_LABEL, the same role GtkLabel
            // sets — and `role="label"` is not in the ARIA role list, so none is written.
            const { el, host } = mount({ text: 'hello' });
            expect(el.hasAttribute('role')).toBe(false);
            host.remove();
        });
    });
};
