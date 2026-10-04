// DOM-level tests for `<gtk-text-view>`: the buffer's text, the Pango properties that reach
// a CSS mechanism (`wrap-mode`, `justification`, `monospace`, the four margins,
// `cursor-visible`) and `accepts-tab`, whose GTK default is the OPPOSITE of a browser's.
//
// The paragraph sppacings are not here: they are Pango's paragraph model, which a textarea
// has no counterpart for, and they are declared in `check-adwaita-element-properties.mjs`.

import { describe, expect, it } from '@gjsify/unit';

import type { GtkTextView } from './elements/gtk-text-view.js';

function mount(text = ''): GtkTextView {
    const el = document.createElement('gtk-text-view') as GtkTextView;
    el.textContent = text;
    document.body.appendChild(el);
    return el;
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-text-view'))) el.remove();
}

/**
 * A Tab the element has to intercept: a synthetic keydown is all a test can produce. The
 * caret is placed explicitly, because where a fresh control leaves it is the engine's
 * choice and the row is about the INSERTION.
 */
function pressTab(textarea: HTMLTextAreaElement, at = 0): KeyboardEvent {
    textarea.setSelectionRange(at, at);
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);
    return event;
}

export const GtkTextViewTest = async () => {
    await describe('<gtk-text-view> the buffer', async () => {
        await it('takes its text from the light DOM, which is where a buffer goes', () => {
            const el = mount('one\ntwo');
            expect(el.text).toBe('one\ntwo');
            expect(el.textarea.value).toBe('one\ntwo');
            unmountAll();
        });

        await it('lets an explicit `text` attribute win over it', () => {
            const el = mount('light dom');
            el.setAttribute('text', 'from the attribute');
            unmountAll();
            const second = document.createElement('gtk-text-view') as GtkTextView;
            second.textContent = 'light dom';
            second.setAttribute('text', 'from the attribute');
            document.body.appendChild(second);
            expect(second.text).toBe('from the attribute');
            second.remove();
        });

        await it("re-emits the buffer's `changed` on an edit", () => {
            const el = mount('a');
            const seen: unknown[] = [];
            el.addEventListener('changed', (event) => seen.push((event as CustomEvent).detail));
            el.textarea.value = 'ab';
            el.textarea.dispatchEvent(new Event('input', { bubbles: true }));
            expect(seen).toStrictEqual([{ text: 'ab' }]);
            unmountAll();
        });
    });

    await describe('<gtk-text-view> wrap mode', async () => {
        await it("defaults to Pango's `none`, so lines do not wrap", () => {
            const el = mount();
            expect(el.wrapMode).toBe('none');
            expect(getComputedStyle(el.textarea).whiteSpace).toBe('pre');
            unmountAll();
        });

        await it('maps each Pango nick onto the CSS that breaks lines the same way', () => {
            const el = mount();
            el.wrapMode = 'word';
            expect(getComputedStyle(el.textarea).whiteSpace).toBe('pre-wrap');
            expect(getComputedStyle(el.textarea).wordBreak).toBe('normal');
            el.wrapMode = 'char';
            expect(getComputedStyle(el.textarea).wordBreak).toBe('break-all');
            el.wrapMode = 'word-char';
            expect(getComputedStyle(el.textarea).overflowWrap).toBe('anywhere');
            unmountAll();
        });

        await it('reads an unknown nick as the pspec default, `none`', () => {
            const el = mount();
            el.setAttribute('wrap-mode', 'diagonal');
            expect(el.wrapMode).toBe('none');
            unmountAll();
        });
    });

    await describe('<gtk-text-view> justification and margins', async () => {
        await it("reads Pango's justification as `text-align`, `fill` included", () => {
            const el = mount();
            expect(el.justification).toBe('left');
            expect(getComputedStyle(el.textarea).textAlign).toBe('start');
            el.justification = 'fill';
            expect(getComputedStyle(el.textarea).textAlign).toBe('justify');
            el.justification = 'center';
            expect(getComputedStyle(el.textarea).textAlign).toBe('center');
            unmountAll();
        });

        await it('turns the four margins into padding the theme ADDS to, as GTK says', () => {
            const el = mount();
            expect(getComputedStyle(el.textarea).paddingTop).toBe('6px');
            el.topMargin = 12;
            el.rightMargin = 4;
            el.bottomMargin = 2;
            el.leftMargin = 8;
            const style = getComputedStyle(el.textarea);
            expect(style.paddingTop).toBe('18px');
            expect(style.paddingRight).toBe('10px');
            expect(style.paddingBottom).toBe('8px');
            expect(style.paddingLeft).toBe('14px');
            unmountAll();
        });

        await it("floors a margin at zero, like the pspec's own minimum", () => {
            const el = mount();
            el.topMargin = -20;
            expect(el.topMargin).toBe(0);
            unmountAll();
        });
    });

    await describe('<gtk-text-view> monospace', async () => {
        await it("is libadwaita's own `.monospace` class, reaching the inner control", () => {
            const el = mount();
            const plain = getComputedStyle(el.textarea).fontFamily;
            el.monospace = true;
            expect(el.classList.contains('monospace')).toBe(true);
            expect(getComputedStyle(el.textarea).fontFamily).not.toBe(plain);
            unmountAll();
        });
    });

    await describe('<gtk-text-view> editable and the cursor', async () => {
        await it('is editable with a visible cursor by default', () => {
            const el = mount();
            expect(el.editable).toBe(true);
            expect(el.cursorVisible).toBe(true);
            expect(el.textarea.readOnly).toBe(false);
            expect(getComputedStyle(el.textarea).caretColor).not.toBe('transparent');
            unmountAll();
        });

        await it('takes both from a VALUE, because both pspecs default TRUE', () => {
            const el = mount();
            el.setAttribute('editable', 'false');
            el.setAttribute('cursor-visible', 'false');
            expect(el.editable).toBe(false);
            expect(el.cursorVisible).toBe(false);
            expect(el.textarea.readOnly).toBe(true);
            // `caret-color: transparent` computes to `rgba(0, 0, 0, 0)` on some engines and
            // to the keyword on others, so the row compares against a probe carrying the same
            // declaration rather than naming either spelling.
            const probe = document.createElement('textarea');
            probe.style.caretColor = 'transparent';
            document.body.appendChild(probe);
            expect(getComputedStyle(el.textarea).caretColor).toBe(getComputedStyle(probe).caretColor);
            probe.remove();
            unmountAll();
        });
    });

    await describe('<gtk-text-view> accepts tab', async () => {
        await it('defaults TRUE, so Tab inserts a tab character and focus stays', () => {
            const el = mount('ab');
            expect(el.acceptsTab).toBe(true);
            const event = pressTab(el.textarea, 1);
            expect(event.defaultPrevented).toBe(true);
            expect(el.text).toBe('a\tb');
            unmountAll();
        });

        await it('gives the browser its own Tab back when it is FALSE', () => {
            const el = mount('ab');
            el.acceptsTab = false;
            const event = pressTab(el.textarea);
            expect(event.defaultPrevented).toBe(false);
            expect(el.text).toBe('ab');
            unmountAll();
        });
    });
};
