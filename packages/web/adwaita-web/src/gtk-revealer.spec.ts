// DOM-level tests for <gtk-revealer>. The animation is driven from a frame clock the C
// reads from GdkFrameClock, so every assertion here drives it the way a browser can be
// driven deterministically: `transition-duration="0"`, which is the C's own
// "no animation" branch, plus the geometry the position produces — the clip box sized to
// `ceil (natural × scale)` and the child's transform chain — which is the part of
// `gtk_revealer_size_allocate` a reader of the element can actually see.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkRevealer } from './elements/gtk-revealer.js';

function mount(attrs: Record<string, string> = {}): { el: GtkRevealer; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-revealer') as GtkRevealer;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    const child = document.createElement('div');
    child.id = 'body';
    child.style.height = '80px';
    child.style.width = '120px';
    el.appendChild(child);
    host.appendChild(el);
    return { el, host };
}

/** Collect the `detail` of every `event` dispatched on `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

export const GtkRevealerTest = async () => {
    await describe('<gtk-revealer> state', async () => {
        await it('starts closed, unrevealed, and named for assistive technology', () => {
            const { el, host } = mount();
            expect(el.revealChild).toBe(false);
            expect(el.childRevealed).toBe(false);
            expect(el.getAttribute('role')).toBe('group');
            expect(el.classList.contains('revealed')).toBe(false);
            host.remove();
        });

        await it('an unknown transition-type leaves the pspec default in place', () => {
            const { el, host } = mount({ 'transition-type': 'slide-sideways' });
            // `slide-down` is `GTK_REVEALER_TRANSITION_TYPE_SLIDE_DOWN`, the pspec default
            // (gtkrevealer.c:120-128) and the answer GtkBuilder gives an unknown nick.
            expect(el.transitionType).toBe('slide-down');
            host.remove();
        });

        await it('duration 0 is a real duration, and a negative one is not one at all', () => {
            const { el, host } = mount();
            expect(el.transitionDuration).toBe(250);
            el.transitionDuration = 0;
            expect(el.transitionDuration).toBe(0);
            // The pspec is a `guint`, so a negative value is not a duration — the default is
            // what a property set of one leaves behind.
            el.transitionDuration = -5;
            expect(el.transitionDuration).toBe(250);
            host.remove();
        });

        await it('a declarative reveal-child attribute lands before the first frame', async () => {
            const { el, host } = mount({ 'reveal-child': '', 'transition-duration': '0' });
            await new Promise((resolve) => requestAnimationFrame(resolve));
            expect(el.revealChild).toBe(true);
            expect(el.childRevealed).toBe(true);
            expect(el.classList.contains('revealed')).toBe(true);
            host.remove();
        });

        await it('re-setting the same value notifies nothing', () => {
            const { el, host } = mount({ 'transition-duration': '0' });
            const revealed = record(el, 'notify::reveal-child');
            el.revealChild = true;
            el.revealChild = true;
            expect(revealed.length).toBe(1);
            host.remove();
        });

        await it('notifies child-revealed when the position lands, and only then', () => {
            const { el, host } = mount({ 'transition-duration': '0' });
            const landed = record(el, 'notify::child-revealed');
            el.revealChild = true;
            expect(landed).toStrictEqual([{ childRevealed: true }]);
            el.revealChild = false;
            expect(landed).toStrictEqual([{ childRevealed: true }, { childRevealed: false }]);
            host.remove();
        });
    });

    await describe('<gtk-revealer> geometry', async () => {
        await it("a crossfade scales neither axis, so the box is the child's own", async () => {
            const { el, host } = mount({ 'transition-duration': '0', 'transition-type': 'crossfade' });
            el.revealChild = true;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const clip = el.querySelector('.adw-revealer-clip') as HTMLElement;
            // `get_child_size_scale` returns 1.0 for CROSSFADE on both axes, so nothing is
            // written and the box measures the child.
            expect(clip.style.height).toBe('');
            expect(clip.style.width).toBe('');
            expect(clip.getBoundingClientRect().height).toBe(80);
            host.remove();
        });

        await it('a slide-down scales the height by the position and holds the child full size', async () => {
            const { el, host } = mount({ 'transition-duration': '0' });
            // Halfway through, which is the only position a duration-0 run passes through
            // if the target is set before the first frame.
            const clip = el.querySelector('.adw-revealer-clip') as HTMLElement;
            const child = clip.firstElementChild as HTMLElement;
            expect(clip.getBoundingClientRect().height).toBe(0);
            expect(child.getBoundingClientRect().height).toBe(80);
            // The child's transform is `translate (0, height - child_height)`, which at a
            // closed revealer is the whole child — the C's `overflow: hidden` is what hides
            // it, not a scaled paint.
            expect(child.style.transform).toBe('translateY(-80px)');
            el.revealChild = true;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            expect(clip.getBoundingClientRect().height).toBe(80);
            expect(child.style.transform).toBe('translateY(0px)');
            host.remove();
        });

        await it('slide-left pins the child at its own origin and scales the width', async () => {
            const { el, host } = mount({ 'transition-duration': '0', 'transition-type': 'slide-left' });
            el.revealChild = true;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const clip = el.querySelector('.adw-revealer-clip') as HTMLElement;
            const child = clip.firstElementChild as HTMLElement;
            // The C's switch has no case for SLIDE_LEFT, so the chain is empty — and its
            // scale still takes the width.
            expect(child.style.transform).toBe('');
            expect(clip.getBoundingClientRect().width).toBe(120);
            host.remove();
        });

        await it('a fading type writes the position as the opacity', async () => {
            const { el, host } = mount({ 'transition-duration': '0', 'transition-type': 'crossfade' });
            const child = el.querySelector('.adw-revealer-clip')?.firstElementChild as HTMLElement;
            expect(child.style.opacity).toBe('0');
            el.revealChild = true;
            expect(child.style.opacity).toBe('1');
            // `none` is not a fading type at all, so the property is left unset rather than
            // pinned to 1 — `gtk_revealer_snapshot` pushes no opacity for it.
            el.transitionType = 'slide-down';
            el.revealChild = false;
            expect(child.style.opacity).toBe('');
            host.remove();
        });

        await it('clips, so the child stays in the accessibility tree while closed', () => {
            const { el, host } = mount();
            // gtkrevealer.c:61-63 — "always available in the accessibility tree, regardless of
            // the state of the revealer widget", which rules out `display: none` and
            // `visibility: hidden` on the child.
            expect(getComputedStyle(el).overflow).toBe('hidden');
            const child = el.querySelector('.adw-revealer-clip')?.firstElementChild as HTMLElement;
            expect(child.style.display).toBe('');
            expect(child.hasAttribute('hidden')).toBe(false);
            host.remove();
        });
    });
};
