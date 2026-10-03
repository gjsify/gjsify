// DOM-level tests for <gtk-scrolled-window>: the parts are GTK's (a viewport and two
// scrollbars), the visibility rule is `upper - lower > page_size` and nothing else, and the
// keys are the ones `gtk_scrolled_window_class_init` installs — Control for the arrows, and
// Page Up/Down on the vertical axis bare while Ctrl+Page Up/Down is the horizontal one.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkScrolledWindow } from './elements/gtk-scrolled-window.js';

/**
 * A host of a known size and a window of its own, because GTK gives this widget an
 * ALLOCATION and a browser one has to be given the same: an auto-height scrolled window grows
 * with its content and has nothing to scroll.
 */
function mount(width = 200, height = 100): { el: GtkScrolledWindow; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    document.body.appendChild(host);
    const el = document.createElement('gtk-scrolled-window') as GtkScrolledWindow;
    el.style.height = `${height}px`;
    host.appendChild(el);
    return { el, host };
}

/**
 * One frame plus a microtask, which is where the slot observer's callback and the viewport's
 * content watcher both land: the observer that adopts a late child is a microtask, and the one
 * that re-measures the content is a `ResizeObserver`, delivered before the next paint.
 */
const settle = async (): Promise<void> => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};

/**
 * A column of labels taller than the window, which is what makes a bar appear.
 *
 * Appended AFTER connect on purpose — the binding is live, so a child added later lands where
 * a declared one does, and the tests below are written against that rather than against a
 * parse-time snapshot.
 */
async function fill(el: GtkScrolledWindow, rows = 10): Promise<void> {
    for (let i = 0; i < rows; i++) {
        const label = document.createElement('gtk-label');
        label.setAttribute('label', `Row ${i}`);
        // A flex item is blockified, so the height on the label is the box the viewport
        // measures; an inline label would ignore it.
        label.style.height = '40px';
        el.appendChild(label);
    }
    await settle();
}

const bars = (el: GtkScrolledWindow): { horizontal: HTMLElement; vertical: HTMLElement } => ({
    horizontal: el.hscrollbar() as HTMLElement,
    vertical: el.vscrollbar() as HTMLElement,
});

/** The `detail` of every `event` dispatched on (or bubbling to) `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

export const GtkScrolledWindowTest = async () => {
    await describe('<gtk-scrolled-window> its parts', async () => {
        await it('builds a viewport and two scrollbars, and routes the child into the viewport', async () => {
            const { el, host } = mount();
            await fill(el, 2);
            // GTK wraps a non-scrollable child in a GtkViewport and parents THAT
            // (gtkscrolledwindow.c:785-793), which is what the DOM says here.
            expect(el.viewport.localName).toBe('gtk-viewport');
            expect(el.viewport.childElementCount).toBe(2);
            expect(bars(el).vertical.getAttribute('orientation')).toBe('vertical');
            expect(bars(el).horizontal.getAttribute('orientation')).toBe('horizontal');
            expect(el.getAttribute('role')).toBe('generic');
            host.remove();
        });

        await it('keeps a child appended after connect in the viewport', async () => {
            const { el, host } = mount();
            const late = document.createElement('gtk-label');
            el.appendChild(late);
            await settle();
            expect(el.viewport.contains(late)).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-scrolled-window> the policies', async () => {
        await it('shows an automatic bar only while the content is longer than the window', async () => {
            const { el, host } = mount();
            expect(bars(el).vertical.hidden).toBe(true);
            await fill(el, 10);
            expect(bars(el).vertical.hidden).toBe(false);
            host.remove();
        });

        await it('draws an ALWAYS bar with nothing to scroll, and no NEVER bar ever', async () => {
            const { el, host } = mount();
            el.setAttribute('vscrollbar-policy', 'always');
            expect(bars(el).vertical.hidden).toBe(false);
            el.setAttribute('vscrollbar-policy', 'never');
            expect(bars(el).vertical.hidden).toBe(true);
            await fill(el, 10);
            expect(bars(el).vertical.hidden).toBe(true);
            // An unknown nick is the pspec's `automatic`, not a silent never.
            el.setAttribute('vscrollbar-policy', 'sideways');
            expect(el.vscrollbarPolicy).toBe('automatic');
            expect(bars(el).vertical.hidden).toBe(false);
            host.remove();
        });

        await it('carries the corner and the frame as classes, and the sizes as CSS', async () => {
            const { el, host } = mount();
            expect(el.classList.contains('top-left')).toBe(true);
            el.setAttribute('window-placement', 'bottom-right');
            expect(el.classList.contains('bottom-right')).toBe(true);
            expect(el.classList.contains('top-left')).toBe(false);
            el.setAttribute('has-frame', '');
            expect(el.classList.contains('frame')).toBe(true);
            // -1 is the pspec's default and writes NOTHING, as a size request of no value.
            el.setAttribute('min-content-width', '200');
            el.setAttribute('max-content-height', '300');
            expect(el.style.minWidth).toBe('200px');
            expect(el.style.maxHeight).toBe('300px');
            expect(el.style.minHeight).toBe('');
            expect(el.minContentWidth).toBe(200);
            expect(el.maxContentHeight).toBe(300);
            host.remove();
        });

        await it('adds the child size request to the scrollport, natural or minimum', async () => {
            const { el, host } = mount();
            await fill(el, 10);
            // No request is made until one of the two asks for it: GTK only measures the
            // child when `propagate-natural-*` or a NEVER policy does (gtkscrolledwindow.c:1841-1844).
            expect(el.viewport.style.minHeight).toBe('');
            // The NATURAL request is the child's `max-content` size, propagated up.
            el.setAttribute('propagate-natural-height', '');
            expect(el.propagateNaturalHeight).toBe(true);
            expect(el.viewport.style.minHeight).toBe('max-content');
            // A NEVER policy adds the child's MINIMUM request instead — and the natural one
            // is the larger of the two, so it wins when both are asked for. Both are FALSE in
            // the pspec, so their ATTRIBUTE is their presence, as `has-frame` is.
            el.removeAttribute('propagate-natural-height');
            el.setAttribute('vscrollbar-policy', 'never');
            expect(el.viewport.style.minHeight).toBe('min-content');
            // With both asked for on ONE axis the natural wins, and the other axis keeps
            // its own answer.
            el.setAttribute('propagate-natural-width', '');
            expect(el.viewport.style.minWidth).toBe('max-content');
            expect(el.viewport.style.minHeight).toBe('min-content');
            el.setAttribute('propagate-natural-height', '');
            expect(el.viewport.style.minHeight).toBe('max-content');
            host.remove();
        });
    });

    await describe('<gtk-scrolled-window> scrolling it', async () => {
        await it('moves the position with the keys class_init binds, and emits scroll-child', async () => {
            const { el, host } = mount();
            await fill(el, 10);
            const seen = record(el, 'scroll-child');
            el.focus();
            // Ctrl+ArrowDown is a vertical STEP, and the bare pair is not bound at all.
            press(el, 'ArrowDown');
            expect(el.viewport.vadjustment.value).toBe(0);
            press(el, 'ArrowDown', { ctrlKey: true });
            expect(el.viewport.vadjustment.value).toBe(10);
            press(el, 'PageDown');
            expect(el.viewport.vadjustment.value).toBe(100);
            press(el, 'End', { ctrlKey: true });
            // Ctrl+End is the HORIZONTAL end, and `may_hscroll` is false — nothing scrolls
            // sideways here — so no third `scroll-child` is emitted. Two events, not three.
            expect(el.viewport.hadjustment.value).toBe(0);
            expect(seen.length).toBe(2);
            expect((seen[0] as { scroll: string }).scroll).toBe('step-forward');
            expect((seen[0] as { horizontal: boolean }).horizontal).toBe(false);
            expect((seen[1] as { scroll: string }).scroll).toBe('page-forward');
            host.remove();
        });

        await it('binds Home and End bare as well, on the vertical axis', async () => {
            const { el, host } = mount();
            await fill(el, 10);
            const seen = record(el, 'scroll-child');
            el.focus();
            // Home and End are bound TWICE (gtkscrolledwindow.c:904-907): bare for the
            // VERTICAL axis and with CONTROL for the horizontal one. Dropping the bare pair
            // would leave both dead on the only axis a window usually scrolls.
            el.viewport.scrollAxis('vertical', 120);
            press(el, 'End');
            expect(el.viewport.vadjustment.value).toBe(300);
            expect((seen[0] as { scroll: string }).scroll).toBe('end');
            expect((seen[0] as { horizontal: boolean }).horizontal).toBe(false);
            press(el, 'Home');
            expect(el.viewport.vadjustment.value).toBe(0);
            expect((seen[1] as { scroll: string }).scroll).toBe('start');
            expect((seen[1] as { horizontal: boolean }).horizontal).toBe(false);
            host.remove();
        });

        await it('emits move-focus-out for Ctrl+Tab, which GTK hands to the root', async () => {
            const { el, host } = mount();
            const seen = record(el, 'move-focus-out');
            press(el, 'Tab', { ctrlKey: true, shiftKey: true });
            expect(seen.length).toBe(1);
            // `toEqual` compares with `==` in this runner, so a detail object is read field by
            // field rather than compared as one value.
            expect((seen[0] as { directionType: string }).directionType).toBe('backward');
            host.remove();
        });

        await it('announces edge-reached when the position lands on a limit', async () => {
            const { el, host } = mount();
            await fill(el, 10);
            const seen = record(el, 'edge-reached');
            el.focus();
            // A page is 90% of the window, so it takes a few of them to reach the far edge —
            // and only the move that LANDS on the limit emits, which is what
            // `maybe_emit_edge_reached` checks.
            for (let i = 0; i < 6; i++) press(el, 'PageDown');
            const edges = seen.map((detail) => (detail as { pos: string }).pos);
            expect(edges.includes('bottom')).toBe(true);
            expect(edges.includes('top')).toBe(false);
            el.viewport.scrollAxis('vertical', 0);
            expect(seen.map((detail) => (detail as { pos: string }).pos).includes('top')).toBe(true);
            host.remove();
        });

        await it('drives the bar from the position, and the position from the bar', async () => {
            const { el, host } = mount();
            await fill(el, 10);
            const bar = bars(el).vertical;
            // A bar that is dragged is a viewport that scrolls: one writer per side.
            (bar as unknown as { value: number }).value = 120;
            expect(el.viewport.vadjustment.value).toBe(120);
            el.viewport.scrollAxis('vertical', 60);
            expect((bar as unknown as { value: number }).value).toBe(60);
            host.remove();
        });

        await it('marks the edge indicators on the viewport, which is where the shading lives', async () => {
            const { el, host } = mount();
            await fill(el, 10);
            const seen = record(el, 'edge-overshot');
            // The shading controller reads the wheel deltas a clamped scrollport threw away,
            // so a wheel past the end is what publishes `edge-overshot`.
            el.viewport.scrollAxis('vertical', 100000);
            el.viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
            const overshots = seen.map((detail) => (detail as { pos: string }).pos);
            expect(overshots.length > 0).toBe(true);
            expect(overshots.includes('bottom')).toBe(true);
            host.remove();
        });
    });
};
