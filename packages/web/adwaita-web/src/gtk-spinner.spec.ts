// DOM-level tests for <gtk-spinner>. GtkSpinner has exactly ONE property, so what
// matters is the four facts around it: `spinning` is the state and `:checked` (spelled
// `.checked`) is how the stylesheet sees it, `start()`/`stop()` carry the busy state as
// well as the property, and the drawn picture is the icon GTK loads — a faint ring with
// one quarter arc on it, which is a STATIC shape.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkSpinner } from './elements/gtk-spinner.js';

function mount(attrs: Record<string, string> = {}): { el: GtkSpinner; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-spinner') as GtkSpinner;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

export const GtkSpinnerTest = async () => {
    await describe('<gtk-spinner> state', async () => {
        await it('starts stopped, with no busy state announced', () => {
            // gtkspinner.c:338-340 — the property's default is FALSE, and nothing has
            // called start(), so there is no aria-busy either.
            const { el, host } = mount();
            expect(el.spinning).toBe(false);
            expect(el.classList.contains('checked')).toBe(false);
            expect(el.hasAttribute('aria-busy')).toBe(false);
            host.remove();
        });

        await it('adopts a declarative spinning attribute without emitting', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('gtk-spinner') as GtkSpinner;
            const events: unknown[] = [];
            el.addEventListener('notify::spinning', (e) => events.push((e as CustomEvent).detail));
            el.setAttribute('spinning', '');
            host.appendChild(el);
            expect(el.spinning).toBe(true);
            expect(el.classList.contains('checked')).toBe(true);
            expect(events.length).toBe(0);
            host.remove();
        });

        await it('a programmatic set notifies once per real change', () => {
            const { el, host } = mount();
            const events: unknown[] = [];
            el.addEventListener('notify::spinning', (e) => events.push((e as CustomEvent).detail));
            el.spinning = true;
            el.spinning = true;
            el.spinning = false;
            expect(events).toStrictEqual([{ spinning: true }, { spinning: false }]);
            host.remove();
        });

        await it('the attribute and the property are the same state', () => {
            const { el, host } = mount();
            el.setAttribute('spinning', '');
            expect(el.spinning).toBe(true);
            expect(el.classList.contains('checked')).toBe(true);
            el.spinning = false;
            expect(el.hasAttribute('spinning')).toBe(false);
            expect(el.classList.contains('checked')).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-spinner> start / stop', async () => {
        await it('start sets the property AND the busy state; stop clears both', () => {
            // gtkspinner.c:373-383 and :391-400 — `gtk_accessible_update_state (…,
            // GTK_ACCESSIBLE_STATE_BUSY, …)` is in both methods, not in the setter.
            const { el, host } = mount();
            el.start();
            expect(el.spinning).toBe(true);
            expect(el.getAttribute('aria-busy')).toBe('true');
            el.stop();
            expect(el.spinning).toBe(false);
            expect(el.getAttribute('aria-busy')).toBe('false');
            host.remove();
        });

        await it('setting the property alone does not announce a busy state', () => {
            const { el, host } = mount();
            el.spinning = true;
            expect(el.hasAttribute('aria-busy')).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-spinner> picture', async () => {
        await it('is a faint ring plus ONE quarter arc, the icon GTK loads', () => {
            // refs/gtk/gtk/icons/process-working-symbolic.svg — a full circle at
            // stroke-opacity 0.2 and the arc from (1,8) to (8,1) on a radius-7 circle.
            const { el, host } = mount();
            expect(el.querySelectorAll('.adw-spinner-track').length).toBe(1);
            const arcs = el.querySelectorAll('.adw-spinner-arc');
            expect(arcs.length).toBe(1);
            expect((arcs[0] as SVGPathElement).getAttribute('d')).toBe('M 1 8 A 7 7 0 0 1 8 1');
            const track = el.querySelector('.adw-spinner-track') as SVGCircleElement;
            expect(getComputedStyle(track).strokeOpacity).toBe('0.2');
            host.remove();
        });

        await it('carries the progressbar role and no value range', () => {
            // gtkspinner.c:345 — GTK_ACCESSIBLE_ROLE_PROGRESS_BAR. There is no fraction
            // to report, so none of aria-valuemin/max/now is written.
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('progressbar');
            expect(el.hasAttribute('aria-valuenow')).toBe(false);
            host.remove();
        });

        await it('is 16px until a rule says otherwise, which is its icon size', () => {
            // gtkspinner.c:110-123 — measured from `icon-size`, reported as minimum AND
            // natural, so the box is square at the icon's intrinsic size.
            const { el, host } = mount();
            const box = getComputedStyle(el);
            expect(box.width).toBe('16px');
            expect(box.height).toBe('16px');
            host.remove();
        });

        await it('dims when disabled, the way libadwaita dims a spinner node', () => {
            // refs/libadwaita/src/stylesheet/widgets/_spinner.scss:1-3.
            const { el, host } = mount({ disabled: '' });
            expect(Number(getComputedStyle(el).opacity)).toBeLessThan(1);
            host.remove();
        });
    });
};
