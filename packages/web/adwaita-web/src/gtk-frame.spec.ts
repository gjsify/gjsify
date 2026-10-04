// DOM-level tests for <gtk-frame>: the label is a `<gtk-label>` the element builds from
// the `label` STRING (which is what `gtk_frame_set_label()` does), it is the frame's FIRST
// child (GTK stacks it above the child), and `label-xalign` is the label's `align-self`.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkFrame } from './elements/gtk-frame.js';

function mount(attrs: Record<string, string> = {}, body = ''): { el: GtkFrame; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-frame') as GtkFrame;
    // Children BEFORE attributes, which is the order the HTML parser sets them in for a
    // custom element: the attribute fires the build while the label is the only child, and
    // the author's own child lands after it.
    if (body !== '') el.innerHTML = body;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/** The label widget the frame is currently showing, or null. */
const labelWidget = (el: GtkFrame) => (el.labelWidget as HTMLElement | null) ?? null;

/** One macrotask, which is after the MutationObserver microtask the element repairs in. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const GtkFrameTest = async () => {
    await describe('<gtk-frame> label', async () => {
        await it('builds a gtk-label from the label string and puts it first', () => {
            const { el, host } = mount({ label: 'Details' }, '<gtk-label label="Body"></gtk-label>');
            const label = labelWidget(el);
            expect(label?.tagName.toLowerCase()).toBe('gtk-label');
            expect(label?.getAttribute('label')).toBe('Details');
            expect(el.firstElementChild).toBe(label);
            expect(el.lastElementChild?.getAttribute('label')).toBe('Body');
            host.remove();
        });

        await it('removes the label when the string goes, and rebuilds it when it returns', () => {
            const { el, host } = mount({ label: 'Details' }, '<gtk-label label="Body"></gtk-label>');
            el.removeAttribute('label');
            expect(labelWidget(el)).toBe(null);
            expect(el.children.length).toBe(1);
            el.setAttribute('label', 'Again');
            expect(el.firstElementChild?.getAttribute('label')).toBe('Again');
            host.remove();
        });

        await it('an authored label-widget wins over the string, and keeps its place', () => {
            const { el, host } = mount(
                { label: 'Ignored' },
                '<gtk-label slot="label-widget" label="Authored"></gtk-label><gtk-label label="Body"></gtk-label>',
            );
            const label = labelWidget(el);
            expect(label?.getAttribute('label')).toBe('Authored');
            expect(el.firstElementChild).toBe(label);
            expect(label?.classList.contains('adw-frame-label')).toBe(true);
            host.remove();
        });

        await it('the label-xalign is a fraction, and reaches the label as align-self', () => {
            const { el, host } = mount({ label: 'Details' }, '<gtk-label label="Body"></gtk-label>');
            expect(el.labelXalign).toBe(0);
            expect(labelWidget(el)?.style.alignSelf).toBe('flex-start');
            el.setAttribute('label-xalign', '0.5');
            expect(el.labelXalign).toBe(0.5);
            expect(labelWidget(el)?.style.alignSelf).toBe('center');
            // Out of range lands on the nearer end, which is what the pspec's 0…1 clamp is.
            el.setAttribute('label-xalign', '4');
            expect(el.labelXalign).toBe(1);
            expect(labelWidget(el)?.style.alignSelf).toBe('flex-end');
            el.setAttribute('label-xalign', 'diagonal');
            expect(el.labelXalign).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-frame> surface', async () => {
        await it("is a group, and carries libadwaita's 1px border and card radius", () => {
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('group');
            const style = getComputedStyle(el);
            expect(style.borderTopWidth).toBe('1px');
            expect(style.borderTopStyle).toBe('solid');
            expect(style.overflow).toBe('hidden');
            host.remove();
        });

        await it('notifies on a real change and on none that did not happen', () => {
            const { el, host } = mount({ label: 'One' });
            const notified: unknown[] = [];
            el.addEventListener('notify::label', (event) => notified.push((event as CustomEvent).detail));
            el.label = 'Two';
            el.label = 'Two';
            expect(notified).toStrictEqual([{ label: 'Two' }]);
            host.remove();
        });

        await it('an author who replaces the children gets the label back', async () => {
            const { el, host } = mount({ label: 'Details' }, '<gtk-label label="Body"></gtk-label>');
            el.innerHTML = '<gtk-label label="New body"></gtk-label>';
            await settle();
            expect(el.firstElementChild?.getAttribute('label')).toBe('Details');
            expect(el.lastElementChild?.getAttribute('label')).toBe('New body');
            host.remove();
        });

        await it('survives a re-parent without doubling the label', () => {
            const { el, host } = mount({ label: 'Details' }, '<gtk-label label="Body"></gtk-label>');
            const other = document.createElement('div');
            document.body.appendChild(other);
            other.appendChild(el);
            expect(el.querySelectorAll('gtk-label').length).toBe(2);
            expect(el.firstElementChild?.getAttribute('label')).toBe('Details');
            other.remove();
            host.remove();
        });
    });
};
