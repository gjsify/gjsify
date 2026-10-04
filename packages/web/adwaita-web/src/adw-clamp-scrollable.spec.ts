// DOM-level tests for <adw-clamp-scrollable>: the SAME clamp arithmetic as
// `<adw-clamp>` (adw-clamp-layout.c:156-235) but measured along the ORIENTATION the
// class overrides (adw-clamp-scrollable.c:78-92), and with the scrollport on the
// element rather than the child — the port's one deviation, and the reason
// `hscroll-policy`/`vscroll-policy` write `overflow` here
// (adw-clamp-scrollable.c:440-455).
import { describe, expect, it } from '@gjsify/unit';

import type { AdwClampScrollable } from './elements/adw-clamp-scrollable.js';

/** Wait for a ResizeObserver delivery (it runs after layout, before paint). */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/** A scrollport in a fixed host, with one plain block child — the shape every story uses. */
function mount(
    available: number,
    attributes: Record<string, string> = {},
): { el: AdwClampScrollable; child: HTMLElement; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = `${available}px`;
    host.style.height = `${available}px`;
    document.body.appendChild(host);
    const el = document.createElement('adw-clamp-scrollable') as AdwClampScrollable;
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    const child = document.createElement('div');
    child.textContent = 'clamped';
    el.appendChild(child);
    host.appendChild(el);
    return { el, child, host };
}

/** `clampAllocate`'s three classes, as the element stamps them on the child. */
function sizeClassOf(child: HTMLElement): string | null {
    for (const cls of ['small', 'medium', 'large']) {
        if (child.classList.contains(cls)) return cls;
    }
    return null;
}

export const AdwClampScrollableTest = async () => {
    await describe('<adw-clamp-scrollable> cap along the clamped axis', async () => {
        await it('caps the CHILD, never itself', async () => {
            const { el, child, host } = mount(1000);
            await settle();
            expect(child.style.maxWidth).toBe('600px');
            expect(Math.round(child.getBoundingClientRect().width)).toBe(600);
            // The element is the scrollport: a cap on itself would feed its own capped
            // width back into its own ResizeObserver.
            expect(el.style.maxWidth).toBe('');
            expect(el.clientWidth).toBe(1000);
            host.remove();
        });

        await it('stamps the size class the clamp layout would', async () => {
            const large = mount(1000);
            await settle();
            expect(sizeClassOf(large.child)).toBe('large');
            large.host.remove();

            // 700 sits in the easing region between `lower` 400 and `upper`
            // 400 + 3·200, so the cap bites only halfway.
            const medium = mount(700);
            await settle();
            expect(medium.child.style.maxWidth).toBe('575px');
            expect(sizeClassOf(medium.child)).toBe('medium');
            medium.host.remove();

            const small = mount(300);
            await settle();
            expect(sizeClassOf(small.child)).toBe('small');
            small.host.remove();
        });

        await it('tightens below the cap, easing the transition into it', async () => {
            const { el, child, host } = mount(700);
            el.maximumSize = 600;
            el.tighteningThreshold = 400;
            await settle();
            expect(child.style.maxWidth).toBe('575px');
            host.remove();
        });

        await it('a threshold ABOVE the maximum removes the easing region', async () => {
            const { el, child, host } = mount(700);
            el.maximumSize = 600;
            el.tighteningThreshold = 800;
            await settle();
            expect(child.style.maxWidth).toBe('600px');
            host.remove();
        });

        await it('follows `unit`, through the conversion C does per property', async () => {
            const { el, child, host } = mount(1000);
            el.unit = 'pt';
            el.maximumSize = 450;
            await settle();
            // 450pt at 96dpi is the same 600px the default 600sp is.
            expect(child.style.maxWidth).toBe('600px');
            host.remove();
        });

        await it('a VERTICAL clamp caps the height and centres on the block axis', async () => {
            const { el, child, host } = mount(1000, { orientation: 'vertical' });
            el.style.height = '1000px';
            await settle();
            expect(child.style.maxHeight).toBe('600px');
            expect(child.style.maxWidth).toBe('');
            expect(child.style.marginBlock).toBe('auto');
            expect(child.style.marginInline).toBe('');
            host.remove();
        });

        await it('follows the scrollport instead of pinning the child to the cap', async () => {
            const { child, host } = mount(1000);
            await settle();
            host.style.width = '360px';
            await settle();
            expect(child.style.maxWidth).toBe('360px');
            expect(Math.round(child.getBoundingClientRect().width)).toBe(360);
            host.remove();
        });

        await it('caps a child appended after connect', async () => {
            const { el, host } = mount(1000);
            await settle();
            const late = document.createElement('div');
            el.appendChild(late);
            await settle();
            expect(late.style.maxWidth).toBe('600px');
            host.remove();
        });

        await it('reports the GIR defaults before anything is set', () => {
            const { el, host } = mount(1000);
            expect(el.maximumSize).toBe(600);
            expect(el.tighteningThreshold).toBe(400);
            expect(el.unit).toBe('sp');
            expect(el.orientation).toBe('horizontal');
            host.remove();
        });
    });

    await describe('<adw-clamp-scrollable> the policies decide whether it scrolls', async () => {
        await it('defaults to GTK_POLICY_AUTOMATIC on both axes', async () => {
            const { el, host } = mount(400);
            await settle();
            expect(el.style.overflowX).toBe('auto');
            expect(el.style.overflowY).toBe('auto');
            host.remove();
        });

        await it('`never` clamps the axis shut and `always` always shows it', async () => {
            const { el, host } = mount(400, { 'hscroll-policy': 'never', 'vscroll-policy': 'always' });
            await settle();
            expect(el.style.overflowX).toBe('hidden');
            expect(el.style.overflowY).toBe('scroll');
            host.remove();
        });

        await it('`automatic` scrolls exactly when the content does', async () => {
            // The clamp caps the WIDTH here, so the height is what scrolls.
            const { el, child, host } = mount(400);
            el.style.height = '200px';
            await settle();
            // A child that fits is not scrollable, which is what AUTOMATIC means.
            expect(el.scrollHeight <= el.clientHeight).toBe(true);
            child.style.height = '900px';
            await settle();
            expect(el.scrollHeight).toBeGreaterThan(el.clientHeight);
            host.remove();
        });

        await it('a scrollport with nothing to measure against does not collapse the child', async () => {
            const { el, child, host } = mount(1000, { orientation: 'vertical' });
            el.style.height = '0px';
            await settle();
            // GTK's equivalent is `for_size = -1`: hand the child nothing rather than
            // capping it at 0 and taking the page with it.
            expect(child.style.maxHeight).toBe('');
            expect(child.style.maxWidth).toBe('');
            expect(sizeClassOf(child)).toBeNull();
            host.remove();
        });
    });
};
