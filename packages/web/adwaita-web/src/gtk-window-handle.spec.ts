// DOM-level tests for <gtk-window-handle>: the three titlebar gestures and what they raise.
// The gestures are the whole widget — it has one property, a `child` slot, and no box of its
// own — so what is asserted here is the ACTIONS, in the vocabulary
// `perform_titlebar_action_fallback` uses when a compositor has no opinion.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkWindowHandle } from './elements/gtk-window-handle.js';

function mount(): { el: GtkWindowHandle; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = '400px';
    host.style.height = '40px';
    document.body.appendChild(host);
    const el = document.createElement('gtk-window-handle') as GtkWindowHandle;
    el.style.display = 'contents';
    const title = document.createElement('gtk-label');
    title.setAttribute('label', 'Untitled');
    el.appendChild(title);
    host.appendChild(el);
    return { el, host };
}

/** Every `event` name dispatched on `el`, with its `detail`. */
function record(el: HTMLElement, ...events: string[]): Map<string, unknown[]> {
    const seen = new Map<string, unknown[]>();
    for (const name of events) {
        const details: unknown[] = [];
        seen.set(name, details);
        el.addEventListener(name, (e) => details.push((e as CustomEvent).detail));
    }
    return seen;
}

const click = (el: HTMLElement, init: MouseEventInit = {}): void => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
};

const pointer = (el: HTMLElement, type: string, init: PointerEventInit = {}): void => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }));
};

export const GtkWindowHandleTest = async () => {
    await describe('<gtk-window-handle> the titlebar actions', async () => {
        await it('is a generic role and contributes no box of its own', async () => {
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('generic');
            // `display: contents` IS `GtkBinLayout`'s "the child takes the whole
            // allocation", and what makes a handle usable as a titlebar strip.
            expect(getComputedStyle(el).display).toBe('contents');
            host.remove();
        });

        await it('turns a DOUBLE CLICK into toggle-maximize, and a single click into nothing', async () => {
            const { el, host } = mount();
            const seen = record(el, 'titlebar-action', 'window.toggle-maximized');
            click(el, { button: 0, detail: 1 });
            expect(seen.get('titlebar-action')?.length).toBe(0);
            click(el, { button: 0, detail: 2 });
            expect(seen.get('titlebar-action')?.length).toBe(1);
            expect(seen.get('window.toggle-maximized')?.length).toBe(1);
            const detail = seen.get('titlebar-action')?.[0] as {
                action: string;
                gesture: string;
                windowAction: string;
            };
            expect(detail.action).toBe('toggle-maximize');
            expect(detail.gesture).toBe('double-click');
            expect(detail.windowAction).toBe('window.toggle-maximized');
            host.remove();
        });

        await it('turns a right click into the window menu, as its setting says', async () => {
            const { el, host } = mount();
            const seen = record(el, 'window.menu', 'window-move');
            click(el, { button: 2 });
            expect(seen.get('window.menu')?.length).toBe(1);
            host.remove();
        });

        await it('reads each gesture off its OWN setting default, and refuses a value GTK does not know', async () => {
            const { el, host } = mount();
            // The three pspecs are not the same (gtksettings.c:868-896): a middle click does
            // NOTHING by default, which is the whole point of there being three settings.
            expect(el.actionFor('double-click')).toBe('toggle-maximize');
            expect(el.actionFor('middle-click')).toBe('none');
            expect(el.actionFor('right-click')).toBe('menu');
            el.setAttribute('double-click-action', 'minimize');
            expect(el.actionFor('double-click')).toBe('minimize');
            const seen = record(el, 'window.minimize');
            click(el, { button: 0, detail: 2 });
            expect(seen.get('window.minimize')?.length).toBe(1);
            // An unknown value is `none`, which is the C's own refusal branch — a typo must
            // not minimize a window.
            el.setAttribute('double-click-action', 'minimise');
            expect(el.actionFor('double-click')).toBe('none');
            const none = record(el, 'window.minimize');
            click(el, { button: 0, detail: 2 });
            expect(none.get('window.minimize')?.length).toBe(0);
            // A maximization VARIANT maximizes: `perform_titlebar_action_fallback` matches
            // `toggle-maximize` by prefix, "treat all maximization variants the same"
            // (gtkwindowhandle.c:311-315).
            el.setAttribute('double-click-action', 'toggle-maximize-fullscreen');
            expect(el.actionFor('double-click')).toBe('toggle-maximize');
            host.remove();
        });

        await it('reports `none` on titlebar-action all the same, which is the gesture itself', async () => {
            const { el, host } = mount();
            const seen = record(el, 'titlebar-action', 'window.menu');
            // A middle click, which is `none` by default (gtksettings.c:881-883) — the gesture
            // still happened, so it is still reported, and nothing else fires.
            click(el, { button: 1 });
            expect(seen.get('titlebar-action')?.length).toBe(1);
            expect(seen.get('window.menu')?.length).toBe(0);
            expect((seen.get('titlebar-action')?.[0] as { gesture: string }).gesture).toBe('middle-click');
            el.setAttribute('right-click-action', 'none');
            const right = record(el, 'titlebar-action', 'window.menu');
            click(el, { button: 2 });
            expect(right.get('titlebar-action')?.length).toBe(1);
            expect(right.get('window.menu')?.length).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-window-handle> the drag', async () => {
        await it('raises window-move once the pointer passes the drag threshold', async () => {
            const { el, host } = mount();
            const seen = record(el, 'window-move');
            pointer(el, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 20 });
            // Under the threshold nothing has happened, which is `gtk_drag_check_threshold_double`.
            pointer(el, 'pointermove', { pointerId: 1, clientX: 10, clientY: 21 });
            expect(seen.get('window-move')?.length).toBe(0);
            pointer(el, 'pointermove', { pointerId: 1, clientX: 60, clientY: 20 });
            expect(seen.get('window-move')?.length).toBe(1);
            // The sequence is reset afterwards, so the gesture does not repeat.
            pointer(el, 'pointermove', { pointerId: 1, clientX: 90, clientY: 20 });
            expect(seen.get('window-move')?.length).toBe(1);
            host.remove();
        });

        await it('denies the drag once a multi-click has claimed the sequence', async () => {
            const { el, host } = mount();
            const seen = record(el, 'window-move');
            pointer(el, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 20 });
            pointer(el, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 20 });
            // The second press of a double click: the click gesture claims the sequence and
            // `gtk_event_controller_reset` denies the drag with it (gtkwindowhandle.c:400-406),
            // which is where a browser knows the press count.
            click(el, { button: 0, detail: 2 });
            pointer(el, 'pointermove', { pointerId: 1, clientX: 90, clientY: 20 });
            expect(seen.get('window-move')?.length).toBe(0);
            host.remove();
        });
    });
};
