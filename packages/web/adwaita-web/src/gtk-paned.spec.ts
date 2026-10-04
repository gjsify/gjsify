// DOM-level tests for <gtk-paned>. Two halves, and the split is the point:
//
//   the ARITHMETIC — `gtk_paned_compute_position` (gtkpaned.c:1092-1146) as a pure function
//   over its inputs, including the `last_allocation` branch that a flex layout cannot reach
//   on its own, so it is pinned here rather than left to the browser;
//
//   the PLACEMENT — the two slots, GTK's "no separator is drawn if one of the children is
//   missing", the handle's ARIA window-splitter values, `move-handle`'s keys, and the
//   `position` / `position-set` pairing where a write raises a flag the C declares
//   read-only and a write of -1 lowers it again.
import { describe, expect, it } from '@gjsify/unit';

import { computePanedPosition, type GtkPaned, type PanedPositionInput } from './elements/gtk-paned.js';

/** The two children every fixture mounts: 100px and 300px of request, as GTK would measure. */
function input(over: Partial<PanedPositionInput> = {}): PanedPositionInput {
    return {
        allocation: 400,
        startRequest: 100,
        endRequest: 300,
        resizeStart: true,
        resizeEnd: true,
        shrinkStart: true,
        shrinkEnd: true,
        positionSet: false,
        startChildSize: 0,
        lastAllocation: 0,
        ...over,
    };
}

function mount(attrs: Record<string, string> = {}): { el: GtkPaned; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.style.width = '400px';
    host.style.height = '120px';
    const el = document.createElement('gtk-paned') as GtkPaned;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    const start = document.createElement('div');
    start.id = 'start';
    start.style.width = '100px';
    start.style.height = '40px';
    const end = document.createElement('div');
    end.setAttribute('slot', 'end');
    end.id = 'end';
    end.style.width = '300px';
    end.style.height = '40px';
    el.append(start, end);
    host.appendChild(el);
    return { el, host };
}

/** Collect the `detail` of every `event` dispatched on `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

export const GtkPanedTest = async () => {
    await describe('gtk_paned_compute_position', async () => {
        await it('divides in proportion to the two size requests when both resize', () => {
            // `pos = allocation * ((double)start_child_req / (start_child_req +
            // end_child_req)) + 0.5` — 400 * 100/400 is an exact 100, and the +0.5 floors.
            expect(computePanedPosition(input())).toStrictEqual({ min: 0, max: 400, position: 100 });
            expect(computePanedPosition(input({ startRequest: 300, endRequest: 100 }))).toStrictEqual({
                min: 0,
                max: 400,
                position: 300,
            });
        });

        await it('halves when neither child has a request, rather than dividing by zero', () => {
            expect(computePanedPosition(input({ startRequest: 0, endRequest: 0 }))).toStrictEqual({
                min: 0,
                max: 400,
                position: 200,
            });
        });

        await it('gives a non-resizing start child its own request, and a non-resizing end the rest', () => {
            expect(computePanedPosition(input({ resizeStart: false, resizeEnd: true })).position).toBe(100);
            expect(computePanedPosition(input({ resizeStart: true, resizeEnd: false })).position).toBe(100); // MAX (0, 400 - 300)
        });

        await it('clamps against the shrink flags, and GLib tests the high bound first', () => {
            // `min = shrink_start_child ? 0 : start_child_req` — a start child that may not
            // shrink has a floor of its own request, and `max = MAX (min, max)` inverts
            // whenever the two disagree, which is why this is GLib's CLAMP and not
            // Math.min/Math.max.
            expect(computePanedPosition(input({ shrinkStart: false })).min).toBe(100);
            expect(computePanedPosition(input({ shrinkEnd: false })).max).toBe(100);
            expect(computePanedPosition(input({ shrinkStart: false, shrinkEnd: false }))).toStrictEqual({
                min: 100,
                max: 100,
                position: 100,
            });
        });

        await it('scales an existing position when the paned grows, and holds it before that', () => {
            // "If the position was set before the initial allocation … just clamp it and
            // leave it": `last_allocation > 0` is false, so the position is taken as it is.
            expect(computePanedPosition(input({ positionSet: true, startChildSize: 220 })).position).toBe(220);
            // Once there IS a previous allocation, the divider keeps its share of it.
            expect(
                computePanedPosition(input({ positionSet: true, startChildSize: 100, lastAllocation: 400 })).position,
            ).toBe(100);
            expect(
                computePanedPosition(
                    input({ positionSet: true, startChildSize: 100, lastAllocation: 400, allocation: 800 }),
                ).position,
            ).toBe(200);
            // A non-resizing start child instead takes the whole growth.
            expect(
                computePanedPosition(
                    input({
                        positionSet: true,
                        startChildSize: 100,
                        lastAllocation: 400,
                        allocation: 800,
                        resizeEnd: false,
                    }),
                ).position,
            ).toBe(500);
        });
    });

    await describe('<gtk-paned> placement', async () => {
        await it('routes the bare child to the start pane and slot="end" to the other', () => {
            const { el, host } = mount();
            expect(el.startChild?.id).toBe('start');
            expect(el.endChild?.id).toBe('end');
            expect(el.getAttribute('role')).toBe('group');
            host.remove();
        });

        await it('draws the divider as the separator node a GtkPanedHandle carries', () => {
            const { el, host } = mount();
            const handle = el.querySelector('.adw-paned-handle') as HTMLElement;
            // `separator` is the handle's CSS NAME (gtkpanedhandle.c:88) and `role` is the
            // ARIA reading of that node; `wide` is what `gtk_paned_set_wide_handle` adds.
            expect(handle.classList.contains('separator')).toBe(true);
            expect(handle.getAttribute('role')).toBe('separator');
            expect(handle.tabIndex).toBe(0);
            expect(handle.classList.contains('wide')).toBe(false);
            expect(getComputedStyle(handle).backgroundColor).toBe('rgba(0, 0, 0, 0)');
            el.wideHandle = true;
            expect(handle.classList.contains('wide')).toBe(true);
            expect(getComputedStyle(handle).minWidth).toBe('5px');
            host.remove();
        });

        await it('the handle reports the divider as its accessible value', async () => {
            const { el, host } = mount();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const handle = el.querySelector('.adw-paned-handle') as HTMLElement;
            expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
            expect(handle.getAttribute('aria-valuemin')).toBe('0');
            // GTK's VALUE_MAX is the paned's own width, handle included.
            expect(Number(handle.getAttribute('aria-valuemax'))).toBeGreaterThan(el.position);
            host.remove();
        });

        await it('draws no separator when one of the children is missing', async () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.style.width = '200px';
            host.style.height = '60px';
            const el = document.createElement('gtk-paned') as GtkPaned;
            const lone = document.createElement('div');
            lone.style.width = '50px';
            lone.style.height = '20px';
            el.appendChild(lone);
            host.appendChild(el);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            // "No separator is drawn if one of the children is missing" (gtkpaned.c:70).
            expect((el.querySelector('.adw-paned-handle') as HTMLElement).hidden).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-paned> position', async () => {
        await it('an authored position raises position-set, as a setter would', async () => {
            const { el, host } = mount({ position: '150' });
            await new Promise((resolve) => requestAnimationFrame(resolve));
            expect(el.position).toBe(150);
            expect(el.positionSet).toBe(true);
            host.remove();
        });

        await it('a write notifies position and position-set once each, a rewrite neither', () => {
            const { el, host } = mount();
            const position = record(el, 'notify::position');
            const positionSet = record(el, 'notify::position-set');
            el.position = 150;
            el.position = 150;
            expect(position.length).toBe(1);
            expect(positionSet).toStrictEqual([{ positionSet: true }]);
            host.remove();
        });

        await it('a write of -1 puts the divider back to being derived', () => {
            const { el, host } = mount();
            const positionSet = record(el, 'notify::position-set');
            el.position = 150;
            el.position = -1;
            expect(el.positionSet).toBe(false);
            expect(positionSet).toStrictEqual([{ positionSet: true }, { positionSet: false }]);
            host.remove();
        });

        await it('an unparseable position attribute is not a position at all', async () => {
            const { el, host } = mount({ position: 'halfway' });
            await new Promise((resolve) => requestAnimationFrame(resolve));
            expect(Number.isNaN(el.position)).toBe(false);
            expect(el.positionSet).toBe(false);
            host.remove();
        });

        await it("writes the divider as the start pane's basis, with no growth", async () => {
            const { el, host } = mount({ position: '150' });
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const start = el.querySelector('.adw-paned-child') as HTMLElement;
            // `start_child_allocation.width = MAX (1, start_child_size)`.
            expect(start.style.flexBasis).toBe('150px');
            expect(start.style.flexGrow).toBe('0');
            host.remove();
        });
    });

    await describe('<gtk-paned> keyboard', async () => {
        await it("move-handle steps by one and pages by 75, the C's two constants", async () => {
            const { el, host } = mount({ position: '150' });
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const handle = el.querySelector('.adw-paned-handle') as HTMLElement;
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            expect(el.position).toBe(151);
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
            expect(el.position).toBe(226);
            host.remove();
        });

        await it('Home and End are GTK_SCROLL_START and GTK_SCROLL_END, so the two bounds', async () => {
            const { el, host } = mount({ position: '150' });
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const handle = el.querySelector('.adw-paned-handle') as HTMLElement;
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
            expect(el.position).toBe(el.minPosition);
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
            expect(el.position).toBe(el.maxPosition);
            host.remove();
        });

        await it('Return and Escape are accept-position and cancel-position, dispatched not swallowed', async () => {
            const { el, host } = mount({ position: '150' });
            const accepted = record(el, 'accept-position');
            const cancelled = record(el, 'cancel-position');
            const handle = el.querySelector('.adw-paned-handle') as HTMLElement;
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(accepted.length).toBe(1);
            expect(cancelled.length).toBe(1);
            expect(el.position).toBe(150);
            host.remove();
        });
    });
};
