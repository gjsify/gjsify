// DOM-level tests for <gtk-progress-bar>.
//
// Three things matter more than the attribute round-trips: the CLAMP is GLib's
// (`glibClamp` from `@gjsify/adwaita-core`, not a local `Math.min/max`); a ZERO fraction
// makes the indicator VANISH rather than draw a rounded stub
// (`> trough.empty > progress { all: unset }` in `_progress-bar.scss`); and the text node
// really PICKS UP `.dimmed` + `.numeric` from `_labels.scss` — a `@extend` that reached
// nothing would look identical in the source.

import { describe, expect, it } from '@gjsify/unit';

import type { GtkProgressBar } from './elements/gtk-progress-bar.js';

function mount(): { el: GtkProgressBar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-progress-bar') as GtkProgressBar;
    host.appendChild(el);
    return { el, host };
}

/** The parts, by the markup contract the stylesheet selects on. */
function parts(bar: GtkProgressBar): { trough: HTMLElement; progress: HTMLElement; text: HTMLElement } {
    return {
        trough: bar.querySelector('.adw-progress-bar-trough') as HTMLElement,
        progress: bar.querySelector('.adw-progress-bar-progress') as HTMLElement,
        text: bar.querySelector('.adw-progress-bar-text') as HTMLElement,
    };
}

export const GtkProgressBarTest = async () => {
    await describe('<gtk-progress-bar> fraction', async () => {
        await it('starts empty, with the trough flagged so the indicator disappears', () => {
            const { el, host } = mount();
            const { trough, progress } = parts(el);
            expect(el.fraction).toBe(0);
            expect(trough).toBeTruthy();
            expect(progress).toBeTruthy();
            expect(trough.classList.contains('empty')).toBe(true);
            expect(el.getAttribute('role')).toBe('progressbar');
            expect(el.getAttribute('aria-valuenow')).toBe('0');
            host.remove();
        });

        await it('fills to the fraction and drops the empty flag', () => {
            const { el, host } = mount();
            el.fraction = 0.25;
            const { trough, progress } = parts(el);
            expect(trough.classList.contains('empty')).toBe(false);
            expect(progress.style.width).toBe('25%');
            expect(el.getAttribute('aria-valuenow')).toBe('0.25');
            host.remove();
        });

        await it('clamps out-of-range and unusable fractions', () => {
            const { el, host } = mount();
            el.fraction = 1.5;
            expect(el.fraction).toBe(1);
            expect(parts(el).progress.style.width).toBe('100%');
            el.fraction = -3;
            expect(el.fraction).toBe(0);
            // A garbage attribute is GtkProgressBar's default 0, never NaN —
            // NaN would reach both the width and `aria-valuenow`.
            el.setAttribute('fraction', 'later');
            expect(el.fraction).toBe(0);
            expect(el.getAttribute('aria-valuenow')).toBe('0');
            host.remove();
        });
    });

    await describe('<gtk-progress-bar> indeterminate', async () => {
        await it('pulse() enters the pulsing state and drops aria-valuenow', () => {
            const { el, host } = mount();
            el.fraction = 0.4;
            expect(el.getAttribute('aria-valuenow')).toBe('0.4');

            el.pulse();

            expect(el.pulsing).toBe(true);
            expect(el.hasAttribute('pulsing')).toBe(true);
            // ARIA spells "indeterminate" as an ABSENT valuenow; a stale 0.4
            // would be announced as real progress.
            expect(el.hasAttribute('aria-valuenow')).toBe(false);
            // A pulsing bar is never `.empty` — the bouncing block is what says
            // "working", so it must not be unset away.
            expect(parts(el).trough.classList.contains('empty')).toBe(false);
            host.remove();
        });

        await it('leaving the pulsing state restores the determinate value', () => {
            const { el, host } = mount();
            el.fraction = 0;
            el.pulse();
            el.pulsing = false;
            expect(el.getAttribute('aria-valuenow')).toBe('0');
            expect(parts(el).trough.classList.contains('empty')).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-progress-bar> text', async () => {
        await it('hides the text node until show-text, then shows the percentage', () => {
            const { el, host } = mount();
            expect(parts(el).text.hidden).toBe(true);

            el.fraction = 0.42;
            el.showText = true;

            expect(parts(el).text.hidden).toBe(false);
            expect(parts(el).text.textContent).toBe('42%');
            host.remove();
        });

        await it('an explicit text wins over the percentage', () => {
            const { el, host } = mount();
            el.showText = true;
            el.fraction = 0.5;
            el.text = 'Copying 3 of 6';
            expect(el.text).toBe('Copying 3 of 6');
            expect(parts(el).text.textContent).toBe('Copying 3 of 6');
            host.remove();
        });

        await it('the text node composes .dimmed and .numeric from _labels.scss', () => {
            // `> text { @extend.dimmed; @extend.numeric; }`
            // (_progress-bar.scss) — this asserts the extends actually
            // REACHED the utility classes, which a source read cannot tell.
            const { el, host } = mount();
            el.showText = true;
            const style = getComputedStyle(parts(el).text);
            expect(style.getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
            expect(Number.parseFloat(style.opacity)).toBeLessThan(1);
            host.remove();
        });
    });

    await describe('<gtk-progress-bar> variants', async () => {
        await it('is an 8px trough by default and a 2px hairline with osd', () => {
            // The 8px is libadwaita's (_progress-bar.scss) and the 2px is its
            // `.osd` variant — NOT the vendored web port's 6px, which
            // has no OSD variant at all.
            //
            // TWO bars rather than one flipped in place, on purpose: the trough
            // TRANSITIONS `background`, so a computed read taken right after an
            // attribute flip returns the INTERPOLATED colour — i.e. still the
            // old one — and the assertion would be timing-dependent. Setting the
            // state before the element's first style resolution leaves no
            // transition to be part-way through.
            const host = document.createElement('div');
            document.body.appendChild(host);
            const plain = document.createElement('gtk-progress-bar') as GtkProgressBar;
            const osd = document.createElement('gtk-progress-bar') as GtkProgressBar;
            osd.setAttribute('osd', '');
            host.append(plain, osd);

            expect(getComputedStyle(parts(plain).trough).height).toBe('8px');
            const osdTrough = getComputedStyle(parts(osd).trough);
            expect(osdTrough.height).toBe('2px');
            expect(osdTrough.backgroundColor).toBe('rgba(0, 0, 0, 0)');
            host.remove();
        });

        await it('inverted fills from the far end', () => {
            const { el, host } = mount();
            expect(getComputedStyle(parts(el).trough).justifyContent).toBe('normal');
            el.inverted = true;
            expect(getComputedStyle(parts(el).trough).justifyContent).toBe('flex-end');
            host.remove();
        });
    });
};
