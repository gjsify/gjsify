// DOM-level tests for <gtk-viewport>: the adjustments are GTK's own configure — a step of a
// tenth of the window and a page of nine tenths — read off the scrollport rather than
// recomputed, and `scroll-to-focus` moves the position the way GTK's focus handler does.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwAdjustment } from '@gjsify/adwaita-core';

import type { GtkViewport } from './elements/gtk-viewport.js';

/**
 * A host of a known size, so a viewport inside it has a measurable page.
 *
 * The VIEWPORT carries the size rather than the host: GTK hands a viewport an allocation from
 * its parent, and in a browser the allocation is a height on the scrollport itself — without
 * one it grows with its content and has nothing to scroll.
 */
function mount(width = 200, height = 100): { el: GtkViewport; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    document.body.appendChild(host);
    const el = document.createElement('gtk-viewport') as GtkViewport;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    host.appendChild(el);
    return { el, host };
}

/** A child of a fixed size, so the viewport's page and content sizes are exact. */
function content(el: GtkViewport, height: number, width = 200): HTMLElement {
    const box = document.createElement('div');
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    el.appendChild(box);
    return box;
}

/** The `detail` of every `event` dispatched on (or bubbling to) `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

/** The `detail` of a `value-changed`, which carries one adjustment per axis. */
const detail = (value: unknown): { hadjustment: AdwAdjustment; vadjustment: AdwAdjustment } =>
    value as { hadjustment: AdwAdjustment; vadjustment: AdwAdjustment };

export const GtkViewportTest = async () => {
    await describe('<gtk-viewport> the adjustments', async () => {
        await it('is a generic role, and an empty one has nothing to scroll', async () => {
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('generic');
            // No content: the range is exactly the window, which is `upper == page_size` and
            // the reason an automatic scrollbar stays hidden.
            expect(el.vadjustment.upper).toBe(el.vadjustment.pageSize);
            expect(el.vadjustment.value).toBe(0);
            host.remove();
        });

        await it("configures each axis as GTK's viewport does", async () => {
            const { el, host } = mount(200, 100);
            content(el, 400);
            const vertical = el.vadjustment;
            // `viewport_set_adjustment_values`: lower 0, upper the child size, page the
            // viewport size, and the two increments as fractions OF it.
            expect(vertical.lower).toBe(0);
            expect(vertical.upper).toBe(400);
            expect(vertical.pageSize).toBe(100);
            expect(vertical.stepIncrement).toBe(10);
            expect(vertical.pageIncrement).toBe(90);
            expect(el.hadjustment.upper).toBe(200);
            host.remove();
        });

        await it('announces a move as a value-changed, once, with both axes', async () => {
            const { el, host } = mount(200, 100);
            content(el, 400);
            const seen = record(el, 'value-changed');
            el.scrollAxis('vertical', 40);
            expect(seen.length).toBe(1);
            const both = detail(seen[0]);
            expect(both.vadjustment.value).toBe(40);
            expect(both.hadjustment.value).toBe(0);
            host.remove();
        });

        await it("clamps a move into the range, which is set_value's contract", async () => {
            const { el, host } = mount(200, 100);
            content(el, 400);
            el.scrollAxis('vertical', 1000);
            // upper - pageSize = 300.
            expect(el.vadjustment.value).toBe(300);
            el.scrollAxis('vertical', -50);
            expect(el.vadjustment.value).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-viewport> scroll-to-focus', async () => {
        await it('is on by default, and only the literal false turns it off', async () => {
            const { el, host } = mount();
            expect(el.scrollToFocus).toBe(true);
            el.setAttribute('scroll-to-focus', 'false');
            expect(el.scrollToFocus).toBe(false);
            // An unknown value is the pspec's TRUE again, as an unset construct bag is.
            el.setAttribute('scroll-to-focus', 'maybe');
            expect(el.scrollToFocus).toBe(true);
            host.remove();
        });

        await it('notifies the way a GObject property does', async () => {
            const { el, host } = mount();
            const seen = record(el, 'notify::scroll-to-focus');
            el.scrollToFocus = false;
            expect(seen.length).toBe(1);
            // `toEqual` compares with `==` in this runner, so a detail object is read field by
            // field rather than compared as one value.
            expect((seen[0] as Record<string, unknown>)['scroll-to-focus']).toBe(false);
            host.remove();
        });

        await it('brings a focused widget into view, and ignores a change written to itself', async () => {
            const { el, host } = mount(200, 100);
            const last = content(el, 400);
            const button = document.createElement('button');
            button.style.width = '80px';
            button.style.height = '20px';
            el.appendChild(button);
            button.style.marginTop = '360px';
            expect(el.vadjustment.value).toBe(0);
            button.focus();
            // The C checks `FOCUS_WITHIN` and skips a target that is the viewport itself;
            // a real focus change inside it is what moves the adjustment.
            expect(el.vadjustment.value > 0).toBe(true);
            el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
            host.remove();
        });
    });
};
