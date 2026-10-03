// DOM-level tests for <gtk-graphics-offload>. The passthrough itself is the platform's
// and cannot be observed from a test — what CAN be is everything the widget does around
// it: the enum and its default, the early-return guard, the black rectangle, and the bin
// layout the child is given.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkGraphicsOffload } from './elements/gtk-graphics-offload.js';

function mount(attrs: Record<string, string> = {}, child?: string): { el: GtkGraphicsOffload; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-graphics-offload') as GtkGraphicsOffload;
    if (child !== undefined) el.innerHTML = child;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

export const GtkGraphicsOffloadTest = async () => {
    await describe('<gtk-graphics-offload> properties', async () => {
        await it('starts enabled, with no black background and no child', () => {
            // gtkgraphicsoffload.c:107-109 (`self->enabled = GTK_GRAPHICS_OFFLOAD_ENABLED`),
            // :279 (black-background defaults FALSE), and `child` is NULL until set.
            const { el, host } = mount();
            expect(el.enabled).toBe('enabled');
            expect(el.blackBackground).toBe(false);
            expect(el.child).toBe(null);
            host.remove();
        });

        await it('notifies once per real change, and never for an echo', () => {
            // :369 — `if (priv->enabled == enabled) return;` — the same for black-background
            // at :424.
            const { el, host } = mount();
            const enabled: unknown[] = [];
            const black: unknown[] = [];
            el.addEventListener('notify::enabled', (event) => enabled.push((event as CustomEvent).detail['enabled']));
            el.addEventListener('notify::black-background', (event) =>
                black.push((event as CustomEvent).detail['black-background']),
            );
            el.enabled = 'enabled';
            el.blackBackground = false;
            expect(enabled).toStrictEqual([]);
            expect(black).toStrictEqual([]);
            el.enabled = 'disabled';
            el.blackBackground = true;
            expect(enabled).toStrictEqual(['disabled']);
            expect(black).toStrictEqual([true]);
            host.remove();
        });

        await it('reads both properties as attributes', () => {
            const { el, host } = mount({ enabled: 'disabled', 'black-background': '' });
            expect(el.enabled).toBe('disabled');
            expect(el.blackBackground).toBe(true);
            // Anything that is not `disabled` is the GIR default, as `enabled`'s setter is.
            expect(el.getAttribute('enabled')).toBe('disabled');
            host.remove();
        });

        await it('takes the black rectangle over the whole allocation', () => {
            // :213-233 — `gtk_snapshot_append_color (… GDK_RGBA_BLACK …)` before the child.
            const { el, host } = mount();
            expect(el.style.backgroundColor).toBe('');
            el.blackBackground = true;
            expect(el.style.backgroundColor).toBe('rgb(0, 0, 0)');
            el.blackBackground = false;
            expect(el.style.backgroundColor).toBe('');
            host.remove();
        });

        await it('drops the compositor hint when offload is disabled', () => {
            // `sync_subsurface` clears the subsurface when `enabled == DISABLED` (:184-186).
            const { el, host } = mount();
            expect(el.style.willChange).toBe('transform');
            el.enabled = 'disabled';
            expect(el.style.willChange).toBe('');
            el.enabled = 'enabled';
            expect(el.style.willChange).toBe('transform');
            host.remove();
        });
    });

    await describe('<gtk-graphics-offload> the child', async () => {
        await it('is the one slotted child, in the bin box', () => {
            // `GTK_TYPE_BIN_LAYOUT` (gtkgraphicsoffload.c:290) and the one `child` slot.
            const { el, host } = mount({}, '<gtk-label label="Offloaded"></gtk-label>');
            const label = el.child;
            expect(label?.tagName.toLowerCase()).toBe('gtk-label');
            expect(label?.parentElement?.className).toBe('adw-graphics-offload-child');
            host.remove();
        });

        await it('is still the child when it is appended after connect', async () => {
            // The slot binding is live (src/slotted-children.ts), so a renderer that mounts
            // after the element is connected lands in the same place a parse-time child
            // does — on the microtask where the MutationObserver callback runs.
            const { el, host } = mount();
            const label = document.createElement('gtk-label');
            host.appendChild(label);
            label.remove();
            el.appendChild(label);
            await Promise.resolve();
            expect(el.child).toBe(label);
            host.remove();
        });

        await it('fills the wrapper, whatever the child asks for', () => {
            const { el, host } = mount({}, '<gtk-label label="Offloaded"></gtk-label>');
            // The child box is the bin layout's own node, and the partial is what gives it
            // the whole allocation: `display: block` with `width`/`height` 100% is the CSS
            // spelling of "the child is allocated the widget".
            const box = el.querySelector('.adw-graphics-offload-child') as HTMLElement;
            expect(box).not.toBe(null);
            expect(getComputedStyle(box).display).toBe('block');
            host.remove();
        });
    });
};
