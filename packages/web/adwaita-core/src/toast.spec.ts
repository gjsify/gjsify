// Ported from `@gjsify/adwaita-nativescript`'s index.spec.ts alongside the toast
// move (ADR 0004) — the NS package keeps only the `AdwToastOverlay` View render
// (its remaining NS-specific piece). Extended here with the queue ordering +
// one-at-a-time + auto-dismiss lifecycle matrix, which the NS mock could not
// exercise (the real overlay needs `@nativescript/core`).

import { describe, it, expect } from '@gjsify/unit';

import { AdwToast, AdwToastQueue, DEFAULT_TOAST_TIMEOUT } from './toast.js';
import type { ToastScheduler, ToastTimerHandle } from './toast.js';

/**
 * A deterministic scheduler stand-in for the injected timing seam: it records
 * every scheduled callback and lets a test fire the latest one synchronously,
 * so the auto-dismiss lifecycle is exercised without a real timer.
 */
class FakeScheduler implements ToastScheduler {
    private _seq = 0;
    private readonly _pending = new Map<number, { fn: () => void; ms: number }>();

    schedule(callback: () => void, ms: number): ToastTimerHandle {
        const handle = this._seq++;
        this._pending.set(handle, { fn: callback, ms });
        return handle;
    }

    cancel(handle: ToastTimerHandle): void {
        this._pending.delete(handle as number);
    }

    /** Number of live (uncancelled, unfired) timers. */
    get liveCount(): number {
        return this._pending.size;
    }

    /** The `ms` requested for the single live timer (asserts exactly one). */
    get onlyDelay(): number {
        expect(this._pending.size).toBe(1);
        return [...this._pending.values()][0]!.ms;
    }

    /** Fire (and remove) every currently-live timer, oldest first. */
    flush(): void {
        const entries = [...this._pending.entries()].sort((a, b) => a[0] - b[0]);
        this._pending.clear();
        for (const [, { fn }] of entries) fn();
    }
}

/** Build a queue plus the show/hide event log a renderer would drive. */
function makeQueue() {
    const shown: string[] = [];
    const hidden: string[] = [];
    const scheduler = new FakeScheduler();
    const queue = new AdwToastQueue({
        scheduler,
        onShow: (t) => shown.push(t.title),
        onHide: (t) => hidden.push(t.title),
    });
    return { queue, scheduler, shown, hidden };
}

export default async () => {
    await describe('AdwToast value object (Adw.Toast)', async () => {
        await it('defaults the timeout and has no button by default', () => {
            const t = new AdwToast('Saved');
            expect(t.title).toBe('Saved');
            expect(t.timeout).toBe(DEFAULT_TOAST_TIMEOUT);
            expect(t.timeout).toBe(5000);
            expect(t.buttonLabel).toBe('');
            expect(t.hasButton).toBe(false);
        });

        await it('honours explicit timeout and action label', () => {
            const t = new AdwToast('Deleted', { timeout: 2000, buttonLabel: 'Undo' });
            expect(t.timeout).toBe(2000);
            expect(t.buttonLabel).toBe('Undo');
            expect(t.hasButton).toBe(true);
        });
    });

    await describe('AdwToastQueue one-at-a-time policy + ordering', async () => {
        await it('shows the first toast immediately, queues the rest FIFO', () => {
            const { queue, shown } = makeQueue();
            queue.add(new AdwToast('first'));
            expect(shown).toStrictEqual(['first']);
            expect(queue.current!.title).toBe('first');
            expect(queue.showing).toBe(true);

            queue.add(new AdwToast('second'));
            queue.add(new AdwToast('third'));
            // Still only the first is shown; the others wait.
            expect(shown).toStrictEqual(['first']);
            expect(queue.pending).toBe(2);
        });

        await it('advances to the next queued toast on dismiss', () => {
            const { queue, shown, hidden } = makeQueue();
            queue.add(new AdwToast('a'));
            queue.add(new AdwToast('b'));
            queue.add(new AdwToast('c'));

            queue.dismiss();
            expect(hidden).toStrictEqual(['a']);
            expect(shown).toStrictEqual(['a', 'b']);
            expect(queue.current!.title).toBe('b');
            expect(queue.pending).toBe(1);

            queue.dismiss();
            expect(shown).toStrictEqual(['a', 'b', 'c']);
            expect(queue.current!.title).toBe('c');
            expect(queue.pending).toBe(0);

            queue.dismiss();
            expect(hidden).toStrictEqual(['a', 'b', 'c']);
            expect(queue.showing).toBe(false);
            expect(queue.current).toBe(null);
        });

        await it('dismiss is a no-op when nothing is shown', () => {
            const { queue, hidden } = makeQueue();
            queue.dismiss();
            expect(hidden).toStrictEqual([]);
            expect(queue.showing).toBe(false);
        });

        await it('clear drops the current toast and discards the queue without showing them', () => {
            const { queue, shown, hidden } = makeQueue();
            queue.add(new AdwToast('x'));
            queue.add(new AdwToast('y'));
            queue.add(new AdwToast('z'));

            queue.clear();
            expect(hidden).toStrictEqual(['x']); // only the visible one is torn down
            expect(shown).toStrictEqual(['x']); // y/z never shown
            expect(queue.showing).toBe(false);
            expect(queue.pending).toBe(0);
        });
    });

    await describe('AdwToastQueue auto-dismiss lifecycle (injected timing)', async () => {
        await it('schedules a dismiss for the toast timeout and advances on fire', () => {
            const { queue, scheduler, shown, hidden } = makeQueue();
            queue.add(new AdwToast('one', { timeout: 3000 }));
            queue.add(new AdwToast('two', { timeout: 3000 }));
            expect(scheduler.onlyDelay).toBe(3000); // used the toast's timeout

            scheduler.flush(); // the 3 s elapse
            expect(hidden).toStrictEqual(['one']);
            expect(shown).toStrictEqual(['one', 'two']);
            expect(queue.current!.title).toBe('two');
        });

        await it('a sticky toast (timeout 0) schedules no timer', () => {
            const { queue, scheduler } = makeQueue();
            queue.add(new AdwToast('sticky', { timeout: 0 }));
            expect(scheduler.liveCount).toBe(0);
            expect(queue.showing).toBe(true);
        });

        await it('a manual dismiss cancels the pending auto-dismiss timer', () => {
            const { queue, scheduler, hidden } = makeQueue();
            queue.add(new AdwToast('cancelme', { timeout: 5000 }));
            expect(scheduler.liveCount).toBe(1);

            queue.dismiss(); // manual, before the timer fires
            expect(scheduler.liveCount).toBe(0); // timer cancelled
            expect(hidden).toStrictEqual(['cancelme']);

            // A now-stale fire must not double-dismiss.
            scheduler.flush();
            expect(hidden).toStrictEqual(['cancelme']);
        });

        await it('clear cancels the pending auto-dismiss timer', () => {
            const { queue, scheduler } = makeQueue();
            queue.add(new AdwToast('gone', { timeout: 5000 }));
            expect(scheduler.liveCount).toBe(1);
            queue.clear();
            expect(scheduler.liveCount).toBe(0);
        });
    });
};
