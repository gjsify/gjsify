// DOM-level tests for <gtk-label>.
//
// Three things matter more than the attribute round-trips. The text reaches the DOM as ONE
// TEXT NODE whatever it holds — `use-markup` included, which is where an `innerHTML` port
// would execute a string. `xalign` is read off where the text actually SITS in the label's
// box, not off a style the element wrote. And the typography classes from `_labels.scss`
// apply to the element, including inside another widget whose isolation floor would
// otherwise repaint it (`_reset.scss`).

import { describe, expect, it } from '@gjsify/unit';

import {
    LABEL_DISPLAY_TEXT_VECTORS,
    LABEL_JUSTIFY_VECTORS,
    LABEL_XALIGN_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import type { GtkLabel } from './elements/gtk-label.js';

function mount(label: string, parent?: HTMLElement): { el: GtkLabel; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = '400px';
    document.body.appendChild(host);
    const el = document.createElement('gtk-label') as GtkLabel;
    el.label = label;
    (parent ?? host).appendChild(el);
    if (parent) host.appendChild(parent);
    return { el, host };
}

/** Where the rendered TEXT sits, measured on the text node rather than the element. */
function textRect(el: HTMLElement): DOMRect {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
}

export const GtkLabelTest = async () => {
    await describe('<gtk-label> against LABEL_DISPLAY_TEXT_VECTORS', async () => {
        for (const vector of LABEL_DISPLAY_TEXT_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount(vector.label);
                el.useMarkup = vector.useMarkup;
                el.useUnderline = vector.useUnderline;
                // What reached the SCREEN, and that it is one text node: no row may build
                // an element, whatever its markup says.
                expect(el.textContent).toBe(vector.text);
                expect(el.getText()).toBe(vector.text);
                expect(el.childElementCount).toBe(0);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_XALIGN_VECTORS and LABEL_JUSTIFY_VECTORS', async () => {
        for (const vector of LABEL_XALIGN_VECTORS) {
            await it(`xalign: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('xalign');
                else el.setAttribute('xalign', String(vector.value));
                expect(el.xalign).toBe(vector.xalign);
                host.remove();
            });
        }
        for (const vector of LABEL_JUSTIFY_VECTORS) {
            await it(`justify: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('justify');
                else el.setAttribute('justify', vector.value);
                expect(el.justify).toBe(vector.justify);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> text', async () => {
        await it('shows the label as text', () => {
            const { el, host } = mount('Hello');
            expect(el.textContent).toBe('Hello');
            expect(textRect(el).width).toBeGreaterThan(0);
            host.remove();
        });
    });

    await describe('<gtk-label> xalign and justify', async () => {
        await it('centres the text in its box by default (xalign 0.5)', () => {
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            const box = el.getBoundingClientRect();
            const text = textRect(el);
            expect(Math.abs(text.left - box.left - (box.right - text.right)) <= 1).toBe(true);
            host.remove();
        });

        await it('puts the text at the start for 0 and the end for 1', () => {
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            el.xalign = 0;
            expect(Math.round(textRect(el).left)).toBe(Math.round(el.getBoundingClientRect().left));
            el.xalign = 1;
            expect(Math.round(textRect(el).right)).toBe(Math.round(el.getBoundingClientRect().right));
            host.remove();
        });

        await it('splits the free space in the xalign ratio, as the C does', () => {
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            el.xalign = 0.25;
            const box = el.getBoundingClientRect();
            const text = textRect(el);
            const free = box.width - text.width;
            expect(Math.abs(text.left - box.left - free * 0.25) <= 1).toBe(true);
            host.remove();
        });

        await it("aligns the lines through Pango's switch: left/right are start/end, fill justifies", () => {
            const { el, host } = mount('Hi');
            expect(el.justify).toBe('left');
            expect(getComputedStyle(el).textAlign).toBe('start');
            el.justify = 'center';
            expect(getComputedStyle(el).textAlign).toBe('center');
            el.justify = 'right';
            expect(getComputedStyle(el).textAlign).toBe('end');
            el.justify = 'fill';
            expect(getComputedStyle(el).textAlign).toBe('justify');
            host.remove();
        });
    });

    await describe('<gtk-label> wrap and selectable', async () => {
        await it('stays on one line unless wrap is set', () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            const oneLine = textRect(el).height;
            el.wrap = true;
            expect(textRect(el).height).toBeGreaterThan(oneLine * 2);
            expect(el.getBoundingClientRect().width <= 400).toBe(true);
            host.remove();
        });

        await it('is not selectable unless asked, as GtkLabel', () => {
            const { el, host } = mount('Hi');
            expect(getComputedStyle(el).userSelect).toBe('none');
            el.selectable = true;
            expect(getComputedStyle(el).userSelect).toBe('text');
            host.remove();
        });
    });

    await describe('<gtk-label> and the typography classes', async () => {
        await it('takes .title-1 and .heading from _labels.scss', () => {
            const { el, host } = mount('Title');
            el.classList.add('title-1');
            expect(getComputedStyle(el).fontWeight).toBe('800');
            el.classList.replace('title-1', 'heading');
            expect(getComputedStyle(el).fontWeight).toBe('700');
            host.remove();
        });

        await it('dims under .dimmed', () => {
            // `.dim-label` is deliberately NOT here: `style-classes.spec.ts` ledgers it as
            // deprecated in favour of this one.
            const { el, host } = mount('Quiet');
            expect(getComputedStyle(el).opacity).toBe('1');
            el.classList.add('dimmed');
            expect(getComputedStyle(el).opacity === '1').toBe(false);
            host.remove();
        });

        await it('inherits colour and size inside another widget instead of the isolation floor', () => {
            const clamp = document.createElement('adw-clamp');
            clamp.style.color = 'rgb(255, 0, 0)';
            clamp.style.fontSize = '30px';
            const { el, host } = mount('Inside', clamp);
            expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)');
            expect(getComputedStyle(el).fontSize).toBe('30px');
            host.remove();
        });
    });
};
