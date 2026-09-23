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
    LABEL_CHAR_COUNT_VECTORS,
    LABEL_DISPLAY_TEXT_VECTORS,
    LABEL_EFFECTIVE_LINES_VECTORS,
    LABEL_ELLIPSIZE_OVERFLOW_VECTORS,
    LABEL_ELLIPSIZE_VECTORS,
    LABEL_JUSTIFY_VECTORS,
    LABEL_WIDTH_CHARS_EXTENT_VECTORS,
    LABEL_WRAP_MODE_VECTORS,
    LABEL_XALIGN_VECTORS,
    LABEL_YALIGN_VECTORS,
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
        for (const vector of LABEL_YALIGN_VECTORS) {
            await it(`yalign: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('yalign');
                else el.setAttribute('yalign', String(vector.value));
                expect(el.yalign).toBe(vector.yalign);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_ELLIPSIZE_VECTORS and LABEL_WRAP_MODE_VECTORS', async () => {
        for (const vector of LABEL_ELLIPSIZE_VECTORS) {
            await it(`ellipsize: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('ellipsize');
                else el.setAttribute('ellipsize', vector.value);
                expect(el.ellipsize).toBe(vector.ellipsize);
                host.remove();
            });
        }
        for (const vector of LABEL_WRAP_MODE_VECTORS) {
            await it(`wrap-mode: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('wrap-mode');
                else el.setAttribute('wrap-mode', vector.value);
                expect(el.wrapMode).toBe(vector.wrapMode);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_CHAR_COUNT_VECTORS — lines / width-chars / max-width-chars', async () => {
        for (const vector of LABEL_CHAR_COUNT_VECTORS) {
            await it(`lines: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('lines');
                else el.setAttribute('lines', String(vector.value));
                expect(el.lines).toBe(vector.count);
                host.remove();
            });
            await it(`width-chars: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('width-chars');
                else el.setAttribute('width-chars', String(vector.value));
                expect(el.widthChars).toBe(vector.count);
                host.remove();
            });
            await it(`max-width-chars: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('max-width-chars');
                else el.setAttribute('max-width-chars', String(vector.value));
                expect(el.maxWidthChars).toBe(vector.count);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_ELLIPSIZE_OVERFLOW_VECTORS', async () => {
        for (const vector of LABEL_ELLIPSIZE_OVERFLOW_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount('word '.repeat(60).trim());
                el.style.width = '200px';
                el.ellipsize = vector.ellipsize;
                const cs = getComputedStyle(el.querySelector('.adw-label-text') ?? el);
                expect(cs.textOverflow).toBe(vector.overflow);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_EFFECTIVE_LINES_VECTORS', async () => {
        for (const vector of LABEL_EFFECTIVE_LINES_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount('word '.repeat(60).trim());
                el.wrap = vector.wrap;
                el.ellipsize = vector.ellipsize;
                el.lines = vector.lines;
                const held = el.style.getPropertyValue('--gtk-label-lines');
                expect(held).toBe(vector.effective === null ? '' : String(vector.effective));
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_WIDTH_CHARS_EXTENT_VECTORS', async () => {
        for (const vector of LABEL_WIDTH_CHARS_EXTENT_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount('Hi');
                el.widthChars = vector.widthChars;
                el.maxWidthChars = vector.maxWidthChars;
                expect(el.style.minWidth).toBe(vector.minCh === null ? '' : `${vector.minCh}ch`);
                expect(el.style.maxWidth).toBe(vector.maxCh === null ? '' : `${vector.maxCh}ch`);
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

        await it('centres a WRAPPED label by xalign too, not just a one-line one', () => {
            // GTK centres the wrapped BLOCK (gtk_label_get_layout_location), not each line
            // independently — the defect this vector was written for: the block used to
            // fill the full width with no inset at all once it needed more than one line.
            //
            // Measured on the wrap SPAN's own box, not `textRect()`'s `Range` (every other
            // vector in this file uses it): `white-space: pre-wrap` lets a wrapped line's
            // trailing separator space HANG past its line box (CSS Text 3 § white-space-
            // phase-2, a real browser behaviour and not a bug here), which widens a
            // `Range`'s bounding rect on the side a line wrapped without moving anything a
            // viewer can see — the span's own layout box is what is actually centred.
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            el.wrap = true;
            const box = el.getBoundingClientRect();
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(span.width < box.width).toBe(true);
            expect(Math.abs(span.left - box.left - (box.right - span.right)) <= 1).toBe(true);
            host.remove();
        });

        await it('keeps a wrapped block flush with the edge at xalign 0, no inset', () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            el.wrap = true;
            el.xalign = 0;
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(Math.round(span.left)).toBe(Math.round(el.getBoundingClientRect().left));
            host.remove();
        });

        // The block's width is measured, so it has to be measured again when the space
        // changes. Widening is the direction that proves it: narrowing is also caught by
        // the span's `max-width: 100%`, but a block pinned at 200px stays 200px wide in a
        // 400px container until something measures it again.
        await it('re-measures a wrapped block when its container widens', async () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            host.style.width = '200px';
            el.wrap = true;
            // Settle the one-off font re-measure first, or it would widen the block on its own.
            await document.fonts.ready;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            host.style.width = '400px';
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(span.width > 300).toBe(true);
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

    await describe('<gtk-label> ellipsize', async () => {
        const long = 'word '.repeat(60).trim();

        await it('stays as wide as its text when ellipsize is none, the default', () => {
            // `host`, not `el`, is constrained: `gtk-label` is a BLOCK-level flex
            // container and fills its own containing block by default (same as a plain
            // `<div>`), so pinning `el.style.width` would force the box regardless of
            // ellipsize — the text overflowing that box, measured on the text itself, is
            // what "not ellipsized" actually means.
            const { el, host } = mount(long);
            host.style.width = '200px';
            expect(textRect(el).width).toBeGreaterThan(200);
            expect(el.childElementCount).toBe(0);
            host.remove();
        });

        await it('trims to the box and keeps the full text in the property, for end', () => {
            const { el, host } = mount(long);
            el.style.width = '200px';
            el.ellipsize = 'end';
            const box = el.getBoundingClientRect();
            expect(box.width).toBeLessThanOrEqual(201);
            // Held faithfully: the PROPERTY still carries the whole string, as GTK's
            // `label` does — only what the box can show is trimmed.
            expect(el.label).toBe(long);
            expect(el.getText()).toBe(long);
            host.remove();
        });

        await it('draws the SAME end-ellipsis for start and middle — the declared divergence', () => {
            const endEl = mount(long);
            endEl.el.style.width = '200px';
            endEl.el.ellipsize = 'end';
            const startEl = mount(long);
            startEl.el.style.width = '200px';
            startEl.el.ellipsize = 'start';
            const middleEl = mount(long);
            middleEl.el.style.width = '200px';
            middleEl.el.ellipsize = 'middle';
            // `ellipsize` is held exactly as authored…
            expect(startEl.el.ellipsize).toBe('start');
            expect(middleEl.el.ellipsize).toBe('middle');
            // …while every non-`none` mode renders identically to `end`, the one
            // truncating value CSS actually has (`labelEllipsizeOverflowValue`).
            expect(Math.round(startEl.el.getBoundingClientRect().width)).toBe(
                Math.round(endEl.el.getBoundingClientRect().width),
            );
            expect(Math.round(middleEl.el.getBoundingClientRect().width)).toBe(
                Math.round(endEl.el.getBoundingClientRect().width),
            );
            endEl.host.remove();
            startEl.host.remove();
            middleEl.host.remove();
        });

        await it('centres a SHORT ellipsized label by xalign, exactly as the plain text node does', () => {
            // A label that FITS has free space regardless of `ellipsize` — the box only
            // shrinks to the container once the text no longer fits one line.
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            el.ellipsize = 'end';
            const box = el.getBoundingClientRect();
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(Math.abs(span.left - box.left - (box.right - span.right)) <= 1).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-label> wrap-mode', async () => {
        // ONE unbreakable "word", no space for the default WORD mode to break at.
        const unbreakable = 'x'.repeat(80);

        await it('overflows its container under the default, word, with nothing to break at', () => {
            // `.adw-label-text { max-width: 100% }` caps the SPAN's own BOX at the
            // container, wrap-mode or not — the difference is whether the TEXT inside it
            // overflows that box, which is what `textRect` (on the span, not the host)
            // measures.
            const { el, host } = mount(unbreakable);
            host.style.width = '100px';
            el.wrap = true;
            const span = el.querySelector('.adw-label-text') as HTMLElement;
            expect(textRect(span).width).toBeGreaterThan(100);
            host.remove();
        });

        await it('breaks mid-word and fits its container under char', () => {
            const { el, host } = mount(unbreakable);
            host.style.width = '100px';
            el.wrap = true;
            el.wrapMode = 'char';
            const span = el.querySelector('.adw-label-text') as HTMLElement;
            expect(textRect(span).width).toBeLessThanOrEqual(100);
            host.remove();
        });

        await it("has no effect while wrap is off, as the pspec says ('only … if line wrapping is on')", () => {
            const { el, host } = mount(unbreakable);
            const withoutMode = textRect(el).width;
            el.wrapMode = 'char';
            expect(textRect(el).width).toBe(withoutMode);
            host.remove();
        });
    });

    await describe('<gtk-label> lines — "no effect if not wrapping or ellipsized"', async () => {
        const paragraph = 'word '.repeat(60).trim();

        await it('caps a wrapping label to N lines instead of letting it grow', () => {
            const { el: capped, host: cappedHost } = mount(paragraph);
            cappedHost.style.width = '150px';
            capped.wrap = true;
            capped.ellipsize = 'end';
            capped.lines = 2;

            const { el: free, host: freeHost } = mount(paragraph);
            freeHost.style.width = '150px';
            free.wrap = true;
            free.ellipsize = 'end';

            const cappedSpan = capped.querySelector('.adw-label-text')!.getBoundingClientRect();
            const freeSpan = free.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(cappedSpan.height).toBeLessThan(freeSpan.height);
            cappedHost.remove();
            freeHost.remove();
        });

        await it('has no effect on a label that is neither wrapping nor ellipsized', () => {
            const { el: capped, host: cappedHost } = mount(paragraph);
            capped.lines = 1;
            const { el: free, host: freeHost } = mount(paragraph);
            expect(Math.round(capped.getBoundingClientRect().width)).toBe(
                Math.round(free.getBoundingClientRect().width),
            );
            cappedHost.remove();
            freeHost.remove();
        });
    });

    await describe('<gtk-label> yalign', async () => {
        await it('sits the text at the top for 0 and the bottom for 1, in a taller box', () => {
            const { el, host } = mount('Hi');
            el.style.height = '100px';
            el.yalign = 0;
            const top = textRect(el);
            const box = el.getBoundingClientRect();
            expect(Math.round(top.top)).toBe(Math.round(box.top));
            el.yalign = 1;
            const bottom = textRect(el);
            expect(Math.round(bottom.bottom)).toBe(Math.round(box.bottom));
            host.remove();
        });

        await it('centres by default, 0.5, the same box the two edges measured against', () => {
            const { el, host } = mount('Hi');
            el.style.height = '100px';
            const box = el.getBoundingClientRect();
            const text = textRect(el);
            const topGap = text.top - box.top;
            const bottomGap = box.bottom - text.bottom;
            expect(Math.abs(topGap - bottomGap) <= 1).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-label> width-chars and max-width-chars', async () => {
        await it('widens a short label to at least width-chars characters', () => {
            // `gtk-label` is a BLOCK-level flex container and fills the 400px `host` by
            // default (same as a plain `<div>` would) — `min-width` has nothing to widen
            // against there, so both sides shrink-to-fit with `display: inline-flex`
            // first, a test-only override that does not touch the component's own CSS.
            const { el: plain, host: plainHost } = mount('Hi');
            plain.style.display = 'inline-flex';
            const { el: widened, host: widenedHost } = mount('Hi');
            widened.style.display = 'inline-flex';
            widened.widthChars = 20;
            expect(widened.getBoundingClientRect().width).toBeGreaterThan(plain.getBoundingClientRect().width);
            plainHost.remove();
            widenedHost.remove();
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
