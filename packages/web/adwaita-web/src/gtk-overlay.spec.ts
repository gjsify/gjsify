// DOM-level tests for <gtk-overlay>. It has no scalar GIR property of its own — `child` is
// a widget — so what matters here is the SLOT ROUTING that stands in for
// `set_child` / `add_overlay`, and the `get_child_position` alignment the stylesheet's
// flex layer reproduces: a child with no `halign` FILLS, one that names an alignment is
// placed by the generic auto-margin rules, and the `.left` / `.right` / `.top` / `.bottom`
// classes say which edge each one ended up pinned to.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkOverlay } from './elements/gtk-overlay.js';

function mount(children: { tag?: string; attrs?: Record<string, string>; slot?: string }[]): {
    el: GtkOverlay;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.style.width = '200px';
    host.style.height = '120px';
    const el = document.createElement('gtk-overlay') as GtkOverlay;
    for (const child of children) {
        const node = document.createElement(child.tag ?? 'div');
        for (const [name, value] of Object.entries(child.attrs ?? {})) {
            node.setAttribute(name, value);
        }
        if (child.slot !== undefined) node.setAttribute('slot', child.slot);
        node.style.width = '40px';
        node.style.height = '20px';
        el.appendChild(node);
    }
    host.appendChild(el);
    return { el, host };
}

export const GtkOverlayTest = async () => {
    await describe('<gtk-overlay> placement', async () => {
        await it('routes the bare child to the main slot and slot="overlay" above it', () => {
            const { el, host } = mount([
                { tag: 'div', attrs: { id: 'main' } },
                { tag: 'div', attrs: { id: 'badge' }, slot: 'overlay' },
            ]);
            expect(el.child?.id).toBe('main');
            expect(el.overlayLayer.children.length).toBe(1);
            expect(el.overlayLayer.firstElementChild?.id).toBe('badge');
            // The layer is the `graphene_rect_init (0, 0, width, height)` of
            // `gtk_overlay_snapshot_child`, so it covers the whole overlay.
            const overlay = el.getBoundingClientRect();
            const layer = el.overlayLayer.getBoundingClientRect();
            expect(layer.width).toBe(overlay.width);
            expect(layer.height).toBe(overlay.height);
            host.remove();
        });

        await it('takes its size from the main child, which is laid out in the host flow', async () => {
            const { el, host } = mount([{ tag: 'div', attrs: { id: 'main' } }]);
            const main = el.child as HTMLElement;
            main.style.height = '70px';
            // `display: contents` is what keeps the child a DIRECT child of the host, so
            // the overlay's own size is the child's.
            expect(getComputedStyle(el.querySelector('.adw-overlay-child') as Element).display).toBe('contents');
            await new Promise((resolve) => requestAnimationFrame(resolve));
            expect(el.getBoundingClientRect().height).toBe(70);
            host.remove();
        });

        await it('a child that names no alignment FILLS the overlay, as GTK_ALIGN_FILL does', () => {
            const { el, host } = mount([{ tag: 'div' }, { tag: 'div', slot: 'overlay' }]);
            const layer = el.overlayLayer.getBoundingClientRect();
            const badge = el.overlayLayer.firstElementChild as HTMLElement;
            const box = badge.getBoundingClientRect();
            expect(box.width).toBe(layer.width);
            expect(box.height).toBe(layer.height);
            host.remove();
        });

        await it('an halign/valign places the overlay child and cancels the fill', () => {
            const { el, host } = mount([
                { tag: 'div' },
                { tag: 'div', slot: 'overlay', attrs: { halign: 'end', valign: 'end' } },
            ]);
            const layer = el.overlayLayer.getBoundingClientRect();
            const badge = el.overlayLayer.firstElementChild as HTMLElement;
            const box = badge.getBoundingClientRect();
            expect(box.width).toBe(40);
            expect(box.height).toBe(20);
            // `halign="end"` puts the child's right edge on the layer's right edge — the
            // whole of `alloc->x += width - alloc->width`.
            expect(Math.round(layer.right - box.right)).toBe(0);
            expect(Math.round(layer.bottom - box.bottom)).toBe(0);
            host.remove();
        });

        await it('the layer does not take input meant for the main child', () => {
            const { el, host } = mount([{ tag: 'div' }, { tag: 'div', slot: 'overlay', attrs: { halign: 'start' } }]);
            expect(getComputedStyle(el.overlayLayer).pointerEvents).toBe('none');
            expect(getComputedStyle(el.overlayLayer.firstElementChild as Element).pointerEvents).toBe('auto');
            host.remove();
        });
    });

    await describe('<gtk-overlay> edge classes', async () => {
        await it('marks the edges the alignment actually pinned the child to', async () => {
            const { el, host } = mount([
                { tag: 'div' },
                { tag: 'div', slot: 'overlay', attrs: { id: 'tr', halign: 'end', valign: 'end' } },
            ]);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const badge = el.overlayLayer.firstElementChild as HTMLElement;
            // `gtk_overlay_child_update_style_classes` only marks START and END; FILL and
            // CENTER are pinned to no edge at all.
            expect(badge.classList.contains('right')).toBe(true);
            expect(badge.classList.contains('bottom')).toBe(true);
            expect(badge.classList.contains('left')).toBe(false);
            expect(badge.classList.contains('top')).toBe(false);
            host.remove();
        });

        await it('follows an alignment rewritten after connect', async () => {
            const { el, host } = mount([{ tag: 'div' }, { tag: 'div', slot: 'overlay', attrs: { halign: 'start' } }]);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const badge = el.overlayLayer.firstElementChild as HTMLElement;
            expect(badge.classList.contains('left')).toBe(true);
            badge.setAttribute('halign', 'center');
            await new Promise((resolve) => requestAnimationFrame(resolve));
            expect(badge.classList.contains('left')).toBe(false);
            expect(badge.classList.contains('right')).toBe(false);
            host.remove();
        });

        await it('a child adopted after connect gets its classes too', async () => {
            const { el, host } = mount([{ tag: 'div' }]);
            const late = document.createElement('div');
            late.setAttribute('slot', 'overlay');
            late.setAttribute('valign', 'end');
            el.appendChild(late);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            expect(late.classList.contains('bottom')).toBe(true);
            expect(late.classList.contains('top')).toBe(false);
            host.remove();
        });
    });
};
