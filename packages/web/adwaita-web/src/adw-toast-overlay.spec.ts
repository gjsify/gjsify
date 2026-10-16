// DOM-level behaviour tests for <adw-toast-overlay>, in a real browser via the
// @gjsify/adwaita-web browser test axis.
//
// `Adw.ToastOverlay` shows exactly ONE toast at a time and queues the rest,
// advancing only when the visible one is dismissed (manually or by its timeout) — the
// policy `ToastOverlayQueue` owns in `@gjsify/adwaita-core` and this element composes.
// A toast is an `Adw.Toast`, added with `add_toast(toast)` as on GTK.
//
// Timing runs through core's injected `ToastScheduler` seam (a virtual clock), so the
// auto-dismiss lifecycle is deterministic with no real timers.
import { Toast } from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

import type { AdwToastOverlay, ToastScheduler, ToastTimerHandle } from './elements/adw-toast-overlay.js';

/** A deterministic {@link ToastScheduler}: timers fire only when time is advanced. */
class VirtualClock implements ToastScheduler {
    private _now = 0;
    private _seq = 0;
    private readonly _timers = new Map<number, { at: number; run: () => void }>();

    schedule(callback: () => void, ms: number): ToastTimerHandle {
        const handle = ++this._seq;
        this._timers.set(handle, { at: this._now + ms, run: callback });
        return handle;
    }

    cancel(handle: ToastTimerHandle): void {
        this._timers.delete(handle as number);
    }

    /** Move the clock forward, draining every timer that comes due. */
    advance(ms: number): void {
        this._now += ms;
        // A fired timer may schedule another one that is already due (the exit
        // fallback of a toast dismissed mid-advance), so drain until settled.
        for (let guard = 0; guard < 100; guard++) {
            const due = [...this._timers].filter(([, timer]) => timer.at <= this._now);
            if (due.length === 0) return;
            for (const [handle, timer] of due) {
                this._timers.delete(handle);
                timer.run();
            }
        }
        throw new Error('VirtualClock.advance did not settle — a timer keeps rescheduling itself');
    }
}

/** Mount an overlay driven by a virtual clock instead of the browser's timers. */
function mountOverlay(): { overlay: AdwToastOverlay; clock: VirtualClock; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = '<adw-toast-overlay><p>content</p></adw-toast-overlay>';
    const overlay = host.querySelector('adw-toast-overlay') as AdwToastOverlay;
    const clock = new VirtualClock();
    overlay.scheduler = clock;
    return { overlay, clock, host };
}

/** The titles of every toast strip currently in the overlay's DOM. */
function toastTitles(overlay: AdwToastOverlay): string[] {
    return Array.from(overlay.querySelectorAll('.adw-toast .adw-toast-title')).map((el) => el.textContent ?? '');
}

export const AdwToastOverlayTest = async () => {
    await describe('adw-toast-overlay', async () => {
        await it('shows exactly one toast at a time, in FIFO order', async () => {
            const { overlay, clock, host } = mountOverlay();

            overlay.add_toast(new Toast({ title: 'First', timeout: 3 }));
            overlay.add_toast(new Toast({ title: 'Second', timeout: 3 }));
            overlay.add_toast(new Toast({ title: 'Third', timeout: 3 }));

            expect(toastTitles(overlay)).toStrictEqual(['First']);
            expect(overlay.pendingToasts).toBe(2);
            expect(overlay.currentToast?.title).toBe('First');

            // The next toast appears only once the previous one timed out.
            clock.advance(3000);
            expect(toastTitles(overlay)).toStrictEqual(['Second']);
            expect(overlay.pendingToasts).toBe(1);

            clock.advance(3000);
            expect(toastTitles(overlay)).toStrictEqual(['Third']);
            expect(overlay.pendingToasts).toBe(0);

            // The last one fades out; the exit fallback detaches the strip.
            clock.advance(3000);
            expect(overlay.currentToast).toBeNull();
            clock.advance(300);
            expect(toastTitles(overlay)).toStrictEqual([]);

            host.remove();
        });

        await it('holds the queue while a sticky toast (timeout 0) is shown', async () => {
            const { overlay, clock, host } = mountOverlay();

            const sticky = new Toast({ title: 'Sticky', timeout: 0 });
            overlay.add_toast(sticky);
            overlay.add_toast(new Toast({ title: 'Next', timeout: 3 }));

            // No timer was scheduled for the sticky toast, so time does not advance it.
            clock.advance(60_000);
            expect(toastTitles(overlay)).toStrictEqual(['Sticky']);
            expect(overlay.pendingToasts).toBe(1);

            // Dismissing it hands the slot to the queued toast.
            sticky.dismiss();
            expect(toastTitles(overlay)).toStrictEqual(['Next']);
            expect(overlay.pendingToasts).toBe(0);

            host.remove();
        });

        await it('advances the queue when the close button is pressed', async () => {
            const { overlay, host } = mountOverlay();

            const first = new Toast({ title: 'First', timeout: 3 });
            let dismissed = 0;
            first.connect('dismissed', () => {
                dismissed += 1;
            });
            overlay.add_toast(first);
            overlay.add_toast(new Toast({ title: 'Second', timeout: 3 }));

            const close = overlay.querySelector('.adw-toast-close-button') as HTMLButtonElement;
            close.click();

            expect(dismissed).toBe(1);
            expect(toastTitles(overlay)).toStrictEqual(['Second']);
            expect(overlay.pendingToasts).toBe(0);

            host.remove();
        });

        await it('emits button-clicked and advances the queue', async () => {
            const { overlay, host } = mountOverlay();

            const toast = new Toast({ title: 'File moved to Trash', timeout: 3, button_label: 'Undo' });
            let undone = 0;
            toast.connect('button-clicked', () => {
                undone += 1;
            });
            overlay.add_toast(toast);
            overlay.add_toast(new Toast({ title: 'Second', timeout: 3 }));

            const action = overlay.querySelector('.adw-toast-action-button') as HTMLButtonElement;
            expect(action.textContent).toBe('Undo');
            action.click();

            expect(undone).toBe(1);
            expect(toastTitles(overlay)).toStrictEqual(['Second']);

            host.remove();
        });

        await it('draws no action button without a button_label', async () => {
            const { overlay, host } = mountOverlay();

            overlay.add_toast(new Toast({ title: 'Saved' }));
            expect(overlay.querySelector('.adw-toast-action-button')).toBeNull();

            host.remove();
        });

        await it('renders the title as markup unless use_markup is off', async () => {
            const { overlay, host } = mountOverlay();

            overlay.add_toast(new Toast({ title: '<b>Bold</b>', timeout: 0 }));
            expect(overlay.querySelector('.adw-toast-title b')?.textContent).toBe('Bold');
            overlay.dismiss_all();

            const { overlay: plain, host: plainHost } = mountOverlay();
            plain.add_toast(new Toast({ title: '<b>Bold</b>', timeout: 0, use_markup: false }));
            expect(plain.querySelector('.adw-toast-title b')).toBeNull();
            expect(toastTitles(plain)).toStrictEqual(['<b>Bold</b>']);

            host.remove();
            plainHost.remove();
        });

        await it('shows a HIGH priority toast ahead of the current one', async () => {
            const { overlay, host } = mountOverlay();

            overlay.add_toast(new Toast({ title: 'Normal', timeout: 0 }));
            const urgent = new Toast({ title: 'Urgent', timeout: 0, priority: 1 });
            overlay.add_toast(urgent);

            expect(toastTitles(overlay)).toStrictEqual(['Urgent']);
            urgent.dismiss();
            expect(toastTitles(overlay)).toStrictEqual(['Normal']);

            host.remove();
        });

        await it('dismisses the visible toast and the queue on dismiss_all()', async () => {
            const { overlay, clock, host } = mountOverlay();

            overlay.add_toast(new Toast({ title: 'First', timeout: 3 }));
            overlay.add_toast(new Toast({ title: 'Second', timeout: 3 }));
            overlay.dismiss_all();

            expect(overlay.currentToast).toBeNull();
            expect(overlay.pendingToasts).toBe(0);
            clock.advance(300);
            expect(toastTitles(overlay)).toStrictEqual([]);

            host.remove();
        });
    });
};
