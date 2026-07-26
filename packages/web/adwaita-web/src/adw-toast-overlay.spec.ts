// DOM-level behaviour tests for <adw-toast-overlay>. Runs in a real browser via
// the @gjsify/adwaita-web browser test axis.
//
// The regression these guard: the overlay used to append EVERY toast as its own
// strip the moment `addToast()` was called, so three calls stacked three visible
// toasts and each ran its own timer. `Adw.ToastOverlay` shows exactly ONE toast
// at a time and queues the rest FIFO, advancing only when the visible one is
// dismissed (manually or by its timeout) — the policy `AdwToastQueue` in
// `@gjsify/adwaita-core` owns and this element now composes.
//
// Timing is driven through core's injected `ToastScheduler` seam (a virtual
// clock), so the auto-dismiss lifecycle is asserted deterministically with no
// real timers.
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

            overlay.addToast('First', { timeout: 3 });
            overlay.addToast('Second', { timeout: 3 });
            overlay.addToast('Third', { timeout: 3 });

            // BEFORE the fix this was ['First', 'Second', 'Third'] — all three
            // strips mounted at once.
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

            overlay.addToast('Sticky', { timeout: 0 });
            overlay.addToast('Next', { timeout: 3 });

            // No timer was scheduled for the sticky toast, so time does not advance it.
            clock.advance(60_000);
            expect(toastTitles(overlay)).toStrictEqual(['Sticky']);
            expect(overlay.pendingToasts).toBe(1);

            // Dismissing it hands the slot to the queued toast.
            overlay.dismiss();
            expect(toastTitles(overlay)).toStrictEqual(['Next']);
            expect(overlay.pendingToasts).toBe(0);

            host.remove();
        });

        await it('advances the queue when the close button is pressed', async () => {
            const { overlay, host } = mountOverlay();

            overlay.addToast('First', { timeout: 3 });
            overlay.addToast('Second', { timeout: 3 });

            const close = overlay.querySelector('.adw-toast-close-button') as HTMLButtonElement;
            close.click();

            expect(toastTitles(overlay)).toStrictEqual(['Second']);
            expect(overlay.pendingToasts).toBe(0);

            host.remove();
        });

        await it('runs the action callback and advances the queue', async () => {
            const { overlay, host } = mountOverlay();

            let undone = 0;
            overlay.addToast('File moved to Trash', {
                timeout: 3,
                buttonLabel: 'Undo',
                onAction: () => {
                    undone += 1;
                },
            });
            overlay.addToast('Second', { timeout: 3 });

            const action = overlay.querySelector('.adw-toast-action-button') as HTMLButtonElement;
            expect(action.textContent).toBe('Undo');
            action.click();

            expect(undone).toBe(1);
            expect(toastTitles(overlay)).toStrictEqual(['Second']);

            host.remove();
        });

        await it('drops the queued toasts on clearToasts()', async () => {
            const { overlay, clock, host } = mountOverlay();

            overlay.addToast('First', { timeout: 3 });
            overlay.addToast('Second', { timeout: 3 });
            overlay.clearToasts();

            expect(overlay.currentToast).toBeNull();
            expect(overlay.pendingToasts).toBe(0);
            clock.advance(300);
            expect(toastTitles(overlay)).toStrictEqual([]);

            host.remove();
        });
    });
};
