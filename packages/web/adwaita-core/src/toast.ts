// AdwToast + AdwToastQueue — headless Libadwaita-style transient-snackbar queue.
//
// Mirrors `Adw.ToastOverlay` + `Adw.Toast`: the overlay shows at most ONE toast at a time
// and queues the rest, showing each in turn as the previous dismisses (manually or after
// its auto-dismiss timeout). `AdwToast` is the value object; `AdwToastQueue` is the
// ordering + one-at-a-time + auto-dismiss lifecycle.
//
// PLATFORM-NEUTRAL (ADR 0004): renders nothing, touches no global timer. A renderer
// supplies two seams — a {@link ToastScheduler} (its platform timer, or a deterministic
// fake in tests) so the auto-dismiss lifecycle stays HERE and testable, and
// {@link AdwToastQueueHandlers} `onShow`/`onHide` to mount and tear down the visible
// strip. Same shape as {@link AdwBreakpoint} taking renderer-fed size samples.
//
// Reference: refs/libadwaita/src/adw-toast-overlay.c, adw-toast.c
//   (add_toast → queue, show one at a time, dismiss advances to the next).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** Default toast lifetime, in milliseconds (Adwaita's default ≈ 5 s). */
export const DEFAULT_TOAST_TIMEOUT = 5000;

/** Options for constructing an {@link AdwToast}. Mirrors `Adw.Toast`'s properties. */
export interface AdwToastOptions {
    /** Auto-dismiss timeout in ms (`0` = sticky until dismissed). Default {@link DEFAULT_TOAST_TIMEOUT}. */
    timeout?: number;
    /** Optional action-button label (empty = no button). Mirrors `Adw.Toast:button-label`. */
    buttonLabel?: string;
}

/**
 * A single transient toast descriptor. Mirrors `Adw.Toast` — a value object
 * (title + auto-dismiss timeout + optional action) enqueued via
 * {@link AdwToastQueue.add}.
 */
export class AdwToast {
    /** The toast message. */
    title: string;
    /** Auto-dismiss timeout in ms (`0` = sticky). */
    timeout: number;
    /** Action-button label (empty = no button). */
    buttonLabel: string;

    constructor(title = '', options: AdwToastOptions = {}) {
        this.title = title;
        this.timeout = options.timeout ?? DEFAULT_TOAST_TIMEOUT;
        this.buttonLabel = options.buttonLabel ?? '';
    }

    /** Whether this toast carries an action button (the action-button render state). */
    get hasButton(): boolean {
        return this.buttonLabel.length > 0;
    }
}

/** Opaque handle a {@link ToastScheduler} returns for a scheduled auto-dismiss. */
export type ToastTimerHandle = unknown;

/**
 * The injected timing seam. A renderer wraps its platform timer (NativeScript's
 * `setTimeout`/`clearTimeout`, the browser's, a deterministic fake in tests). The
 * queue never references a global `setTimeout`, keeping core platform-neutral.
 */
export interface ToastScheduler {
    /** Run `callback` after `ms`; return a handle {@link cancel} understands. */
    schedule(callback: () => void, ms: number): ToastTimerHandle;
    /** Cancel a pending {@link schedule}. A stale/unknown handle must be a no-op. */
    cancel(handle: ToastTimerHandle): void;
}

/** Render seams driven by the queue as toasts enter/leave the single visible slot. */
export interface AdwToastQueueHandlers {
    /** Mount `toast` as the visible strip (title + optional action button). */
    onShow: (toast: AdwToast) => void;
    /** Tear down `toast`'s strip — it auto-dismissed, was dismissed, or superseded. */
    onHide: (toast: AdwToast) => void;
}

/** Construction seams for {@link AdwToastQueue}: the timing + render adapters. */
export interface AdwToastQueueOptions extends AdwToastQueueHandlers {
    scheduler: ToastScheduler;
}

/**
 * The headless toast queue — `Adw.ToastOverlay`'s one-at-a-time policy + ordering
 * + auto-dismiss lifecycle, with zero rendering and zero global timers.
 *
 * {@link add} enqueues a toast; the first shows immediately (`onShow`), later ones
 * wait FIFO. A shown toast with `timeout > 0` auto-dismisses through the injected
 * {@link ToastScheduler}; {@link dismiss} dismisses the current toast early. Either
 * way, dismissal fires `onHide` and advances to the next queued toast.
 */
export class AdwToastQueue {
    private readonly _scheduler: ToastScheduler;
    private readonly _handlers: AdwToastQueueHandlers;
    private readonly _pending: AdwToast[] = [];
    private _current: AdwToast | null = null;
    private _timer: ToastTimerHandle | null = null;

    constructor(options: AdwToastQueueOptions) {
        this._scheduler = options.scheduler;
        this._handlers = { onShow: options.onShow, onHide: options.onHide };
    }

    /** The toast currently on screen, or `null` when nothing is shown. */
    get current(): AdwToast | null {
        return this._current;
    }

    /** Whether a toast is currently on screen. */
    get showing(): boolean {
        return this._current !== null;
    }

    /** Number of toasts waiting behind the current one. */
    get pending(): number {
        return this._pending.length;
    }

    /**
     * Enqueue a toast. Shows it immediately when the slot is free, otherwise
     * queues it FIFO behind the toasts already waiting.
     */
    add(toast: AdwToast): void {
        if (this._current === null) {
            this._show(toast);
        } else {
            this._pending.push(toast);
        }
    }

    /**
     * Dismiss the current toast early (fires `onHide` and advances to the next
     * queued toast, if any). A no-op when nothing is shown.
     */
    dismiss(): void {
        if (this._current === null) return;
        const toast = this._current;
        this._clearTimer();
        this._current = null;
        this._handlers.onHide(toast);
        const next = this._pending.shift();
        if (next) this._show(next);
    }

    /**
     * Drop every toast — dismiss the current one (firing `onHide`) and discard the
     * pending queue WITHOUT showing them (unlike {@link dismiss}, which advances).
     */
    clear(): void {
        this._pending.length = 0;
        if (this._current === null) return;
        const toast = this._current;
        this._clearTimer();
        this._current = null;
        this._handlers.onHide(toast);
    }

    private _show(toast: AdwToast): void {
        this._current = toast;
        this._handlers.onShow(toast);
        if (toast.timeout > 0) {
            this._timer = this._scheduler.schedule(() => {
                // Identity-guard: only auto-dismiss if this toast is still current
                // (a manual dismiss already cleared the timer, but be defensive).
                if (this._current === toast) this.dismiss();
            }, toast.timeout);
        }
    }

    private _clearTimer(): void {
        if (this._timer !== null) {
            this._scheduler.cancel(this._timer);
            this._timer = null;
        }
    }
}
