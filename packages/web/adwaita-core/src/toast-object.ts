// `Adw.Toast` and the queue of `Adw.ToastOverlay`, renderer-free: the SUBSET a GNOME app's code
// needs to raise a toast the way it does on GTK — `new Adw.Toast({ title, timeout, button_label })`,
// `connect('button-clicked')`, `overlay.add_toast(toast)`, `toast.dismiss()`.
//
// In the subset: `title`, `timeout` (whole SECONDS, a `guint`, default 5), `priority`,
// `button-label`, `action-name`, `use-markup`, the signals `button-clicked` and `dismissed`, and
// `dismiss()`. Out of it, and so absent: `custom-title` (a widget) and `action-target` (a
// `GVariant`), which `ParamSpec` cannot carry.
//
// The overlay's half is {@link ToastOverlayQueue}, the port of `adw-toast-overlay.c`'s queue: one
// toast on screen, a toast's `dismissed` hides it and shows the next, a HIGH toast pushes the
// current one back to the head, re-adding a shown toast restarts its timeout and re-adding a queued
// one bumps it forward. A port feeds it a {@link ToastScheduler} and mounts/tears down the strip in
// `onShow`/`onHide`, the seams `AdwToastQueue` already has. STATE LIVES IN WEAKMAPS, never a class
// field (see `application.ts`).
//
// `AdwToast` / `AdwToastQueue` in `toast.ts` stay as they are: they are the millisecond value object
// `@gjsify/adwaita-react-native`'s ref handle takes, not a GObject.
//
// Reference: libadwaita src/adw-toast.c, src/adw-toast-overlay.c, src/adw-toast-widget.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GIR_TYPE, GObjectObject, ParamFlags, ParamSpec, registerBaseClass } from './gobject.js';
import { MAXUINT32 } from './glib-paths.js';
import type { ToastScheduler, ToastTimerHandle } from './toast.js';

/** `Adw.ToastPriority`, with the values of the GIR. */
export const ToastPriority = {
    NORMAL: 0,
    HIGH: 1,
} as const;

/** The overlay a toast was added to — `adw_toast_get_overlay`, private upstream too. */
const OVERLAY = new WeakMap<object, ToastOverlayQueue>();

export class Toast extends GObjectObject {
    static [GIR_TYPE] = 'Adw.Toast';

    declare title: string;
    declare timeout: number;
    declare priority: number;
    declare button_label: string | null;
    declare buttonLabel: string | null;
    declare action_name: string | null;
    declare actionName: string | null;
    declare use_markup: boolean;
    declare useMarkup: boolean;

    get_title(): string {
        return this.title;
    }

    set_title(title: string): void {
        this.title = title;
    }

    get_timeout(): number {
        return this.timeout;
    }

    set_timeout(timeout: number): void {
        this.timeout = timeout;
    }

    get_priority(): number {
        return this.priority;
    }

    set_priority(priority: number): void {
        this.priority = priority;
    }

    get_button_label(): string | null {
        return this.button_label;
    }

    set_button_label(label: string | null): void {
        this.button_label = label;
    }

    get_action_name(): string | null {
        return this.action_name;
    }

    set_action_name(name: string | null): void {
        this.action_name = name;
    }

    get_use_markup(): boolean {
        return this.use_markup;
    }

    set_use_markup(useMarkup: boolean): void {
        this.use_markup = useMarkup;
    }

    /** Emits `dismissed` — and does nothing for a toast no overlay holds, as `adw_toast_dismiss`. */
    dismiss(): void {
        if (!OVERLAY.has(this)) return;
        this.emit('dismissed');
    }
}

registerBaseClass(Toast as never, 'AdwToast', { 'button-clicked': [], dismissed: [] }, [
    ParamSpec.string('title', '', '', ParamFlags.READWRITE, ''),
    ParamSpec.uint('timeout', '', '', ParamFlags.READWRITE, 0, MAXUINT32, 5),
    ParamSpec.int(
        'priority',
        '',
        '',
        ParamFlags.READWRITE,
        ToastPriority.NORMAL,
        ToastPriority.HIGH,
        ToastPriority.NORMAL,
    ),
    ParamSpec.string('button-label', '', '', ParamFlags.READWRITE, null),
    ParamSpec.string('action-name', '', '', ParamFlags.READWRITE, null),
    ParamSpec.boolean('use-markup', '', '', ParamFlags.READWRITE, true),
]);

/** Construction seams for {@link ToastOverlayQueue}: the timer and the strip. */
export interface ToastOverlayQueueOptions {
    scheduler: ToastScheduler;
    /** Mount `toast` as the visible strip. */
    onShow: (toast: Toast) => void;
    /** Tear down `toast`'s strip — dismissed, timed out, or postponed by a HIGH toast. */
    onHide: (toast: Toast) => void;
}

/** The queue of one `Adw.ToastOverlay`, with zero rendering and zero global timers. */
export class ToastOverlayQueue {
    private readonly _options: ToastOverlayQueueOptions;
    private readonly _queue: Toast[] = [];
    private readonly _handlers = new Map<Toast, number>();
    private _current: Toast | null = null;
    private _timer: ToastTimerHandle | null = null;

    constructor(options: ToastOverlayQueueOptions) {
        this._options = options;
    }

    /** The toast on screen, or `null`. */
    get current(): Toast | null {
        return this._current;
    }

    /** How many toasts wait behind the current one. */
    get pending(): number {
        return this._queue.length;
    }

    /** `adw_toast_overlay_add_toast`. */
    add_toast(toast: Toast): void {
        const owner = OVERLAY.get(toast);
        if (owner === this) {
            if (this._current === toast) this._startTimer(toast);
            else this._bump(toast);
            return;
        }
        if (owner !== undefined) {
            throw new Error(
                `Adding toast '${toast.title}', but it has already been added to a different AdwToastOverlay`,
            );
        }

        OVERLAY.set(toast, this);
        this._handlers.set(
            toast,
            toast.connect('dismissed', () => this._dismissed(toast)),
        );

        if (this._current === null) {
            this._show(toast);
        } else if (toast.priority === ToastPriority.HIGH) {
            const postponed = this._current;
            this._queue.unshift(postponed);
            this._hideCurrent();
            this._show(toast);
        } else {
            this._queue.push(toast);
        }
    }

    /** `adw_toast_overlay_dismiss_all`: every queued toast is dismissed, then the current one. */
    dismiss_all(): void {
        for (const toast of this._queue.splice(0)) {
            this._disconnect(toast);
            toast.dismiss();
            OVERLAY.delete(toast);
        }
        this._current?.dismiss();
    }

    private _dismissed(toast: Toast): void {
        this._disconnect(toast);
        // Upstream leaves the overlay set on a shown toast it frees; clearing it lets the same
        // toast be added again instead of reaching `bump_toast`'s assertion.
        OVERLAY.delete(toast);
        if (toast === this._current) {
            this._hideCurrent();
            const next = this._queue.shift();
            if (next) this._show(next);
        } else {
            const index = this._queue.indexOf(toast);
            if (index !== -1) this._queue.splice(index, 1);
        }
    }

    /** `bump_toast`: a HIGH toast to the head, a NORMAL one behind the HIGH ones. */
    private _bump(toast: Toast): void {
        this._queue.splice(this._queue.indexOf(toast), 1);
        if (toast.priority === ToastPriority.HIGH) {
            this._queue.unshift(toast);
            return;
        }
        const at = this._queue.findIndex((each) => each.priority !== ToastPriority.HIGH);
        this._queue.splice(at === -1 ? this._queue.length : at, 0, toast);
    }

    private _show(toast: Toast): void {
        this._current = toast;
        this._options.onShow(toast);
        this._startTimer(toast);
    }

    private _hideCurrent(): void {
        const toast = this._current;
        if (toast === null) return;
        this._clearTimer();
        // Before the next toast is shifted in, so `pending` still counts it in `onHide`.
        this._current = null;
        this._options.onHide(toast);
    }

    /** `start_timeout` after `end_timeout`: `timeout` counts seconds, `0` means until dismissed. */
    private _startTimer(toast: Toast): void {
        this._clearTimer();
        if (toast.timeout > 0) {
            this._timer = this._options.scheduler.schedule(() => {
                this._timer = null;
                if (this._current === toast) toast.dismiss();
            }, toast.timeout * 1000);
        }
    }

    private _clearTimer(): void {
        if (this._timer !== null) {
            this._options.scheduler.cancel(this._timer);
            this._timer = null;
        }
    }

    private _disconnect(toast: Toast): void {
        const id = this._handlers.get(toast);
        if (id === undefined) return;
        toast.disconnect(id);
        this._handlers.delete(toast);
    }
}
