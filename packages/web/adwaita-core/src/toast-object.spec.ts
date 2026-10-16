// `Adw.Toast` and the `Adw.ToastOverlay` queue, against libadwaita's own rules
// (adw-toast.c, adw-toast-overlay.c) on a deterministic scheduler.

import { describe, expect, it } from '@gjsify/unit';

import { Toast, ToastOverlayQueue, ToastPriority } from './toast-object.js';
import type { ToastScheduler, ToastTimerHandle } from './toast.js';

class FakeScheduler implements ToastScheduler {
    private _seq = 0;
    readonly live = new Map<number, { fn: () => void; ms: number }>();

    schedule(callback: () => void, ms: number): ToastTimerHandle {
        const handle = this._seq++;
        this.live.set(handle, { fn: callback, ms });
        return handle;
    }

    cancel(handle: ToastTimerHandle): void {
        this.live.delete(handle as number);
    }

    flush(): void {
        const entries = [...this.live.values()];
        this.live.clear();
        for (const { fn } of entries) fn();
    }
}

function makeOverlay() {
    const shown: string[] = [];
    const hidden: string[] = [];
    const scheduler = new FakeScheduler();
    const overlay = new ToastOverlayQueue({
        scheduler,
        onShow: (t) => shown.push(t.title),
        onHide: (t) => hidden.push(t.title),
    });
    return { overlay, scheduler, shown, hidden };
}

export default async () => {
    await describe('Adw.Toast', async () => {
        await it('carries libadwaita’s defaults', () => {
            const toast = new Toast();
            expect(toast.title).toBe('');
            expect(toast.timeout).toBe(5);
            expect(toast.priority).toBe(ToastPriority.NORMAL);
            expect(toast.button_label).toBe(null);
            expect(toast.action_name).toBe(null);
            expect(toast.use_markup).toBe(true);
        });

        await it('takes snake_case and camelCase construct properties', () => {
            const a = new Toast({ title: 'Saved', timeout: 2, button_label: 'Undo', action_name: 'app.undo' });
            const b = new Toast({ title: 'Saved', buttonLabel: 'Undo', actionName: 'app.undo', useMarkup: false });
            expect(a.get_button_label()).toBe('Undo');
            expect(a.buttonLabel).toBe('Undo');
            expect(a.get_timeout()).toBe(2);
            expect(b.button_label).toBe('Undo');
            expect(b.action_name).toBe('app.undo');
            expect(b.get_use_markup()).toBe(false);
        });

        await it('notifies a property change', () => {
            const toast = new Toast({ title: 'a' });
            const seen: string[] = [];
            toast.connect('notify::title', () => seen.push(toast.title));
            toast.set_title('b');
            expect(seen).toStrictEqual(['b']);
        });

        await it('dismiss() is a no-op for a toast no overlay holds', () => {
            const toast = new Toast({ title: 'loose' });
            let dismissed = 0;
            toast.connect('dismissed', () => dismissed++);
            toast.dismiss();
            expect(dismissed).toBe(0);
        });

        await it('refuses a property libadwaita does not have', () => {
            expect(() => new Toast({ onAction: () => {} })).toThrow();
        });
    });

    await describe('Adw.ToastOverlay queue', async () => {
        await it('shows one toast and queues the rest', () => {
            const { overlay, shown } = makeOverlay();
            overlay.add_toast(new Toast({ title: 'a' }));
            overlay.add_toast(new Toast({ title: 'b' }));
            expect(shown).toStrictEqual(['a']);
            expect(overlay.pending).toBe(1);
        });

        await it('toast.dismiss() hides the current toast and shows the next', () => {
            const { overlay, shown, hidden } = makeOverlay();
            const a = new Toast({ title: 'a' });
            let dismissed = 0;
            a.connect('dismissed', () => dismissed++);
            overlay.add_toast(a);
            overlay.add_toast(new Toast({ title: 'b' }));
            a.dismiss();
            expect(dismissed).toBe(1);
            expect(hidden).toStrictEqual(['a']);
            expect(shown).toStrictEqual(['a', 'b']);
            expect(overlay.current?.title).toBe('b');
        });

        await it('dismissing a queued toast removes it without showing it', () => {
            const { overlay, shown } = makeOverlay();
            const b = new Toast({ title: 'b' });
            const first = new Toast({ title: 'a' });
            overlay.add_toast(first);
            overlay.add_toast(b);
            b.dismiss();
            expect(overlay.pending).toBe(0);
            first.dismiss();
            expect(shown).toStrictEqual(['a']);
            expect(overlay.current).toBe(null);
        });

        await it('times out after `timeout` SECONDS', () => {
            const { overlay, scheduler, hidden } = makeOverlay();
            overlay.add_toast(new Toast({ title: 'a', timeout: 3 }));
            expect([...scheduler.live.values()].map((t) => t.ms)).toStrictEqual([3000]);
            scheduler.flush();
            expect(hidden).toStrictEqual(['a']);
        });

        await it('timeout 0 keeps the toast until dismissed', () => {
            const { overlay, scheduler } = makeOverlay();
            overlay.add_toast(new Toast({ title: 'a', timeout: 0 }));
            expect(scheduler.live.size).toBe(0);
        });

        await it('a HIGH toast shows now and puts the current one back at the head', () => {
            const { overlay, shown, hidden } = makeOverlay();
            const a = new Toast({ title: 'a' });
            overlay.add_toast(a);
            overlay.add_toast(new Toast({ title: 'b' }));
            const urgent = new Toast({ title: 'urgent', priority: ToastPriority.HIGH });
            overlay.add_toast(urgent);
            expect(hidden).toStrictEqual(['a']);
            expect(overlay.current).toBe(urgent);
            urgent.dismiss();
            expect(shown).toStrictEqual(['a', 'urgent', 'a']);
        });

        await it('re-adding the shown toast restarts its timeout', () => {
            const { overlay, scheduler } = makeOverlay();
            const a = new Toast({ title: 'a', timeout: 3 });
            overlay.add_toast(a);
            overlay.add_toast(a);
            expect(scheduler.live.size).toBe(1);
            expect(overlay.pending).toBe(0);
        });

        await it('re-adding a queued HIGH toast bumps it to the head', () => {
            const { overlay, shown } = makeOverlay();
            const a = new Toast({ title: 'a' });
            overlay.add_toast(a);
            overlay.add_toast(new Toast({ title: 'b' }));
            const c = new Toast({ title: 'c' });
            overlay.add_toast(c);
            c.priority = ToastPriority.HIGH;
            overlay.add_toast(c);
            a.dismiss();
            expect(shown).toStrictEqual(['a', 'c']);
        });

        await it('refuses a toast another overlay holds', () => {
            const one = makeOverlay().overlay;
            const two = makeOverlay().overlay;
            const toast = new Toast({ title: 'a' });
            one.add_toast(toast);
            expect(() => two.add_toast(toast)).toThrow();
        });

        await it('dismiss_all dismisses every toast and cancels the timer', () => {
            const { overlay, scheduler, shown } = makeOverlay();
            const toasts = ['a', 'b', 'c'].map((title) => new Toast({ title }));
            let dismissed = 0;
            for (const toast of toasts) {
                toast.connect('dismissed', () => dismissed++);
                overlay.add_toast(toast);
            }
            overlay.dismiss_all();
            expect(dismissed).toBe(3);
            expect(shown).toStrictEqual(['a']);
            expect(overlay.current).toBe(null);
            expect(overlay.pending).toBe(0);
            expect(scheduler.live.size).toBe(0);
        });

        await it('a dismissed toast can be added again', () => {
            const { overlay, shown } = makeOverlay();
            const a = new Toast({ title: 'a' });
            overlay.add_toast(a);
            a.dismiss();
            overlay.add_toast(a);
            expect(shown).toStrictEqual(['a', 'a']);
        });
    });
};
