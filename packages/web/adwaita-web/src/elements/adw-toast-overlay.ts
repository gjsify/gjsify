// <adw-toast-overlay> — the web counterpart of Adw.ToastOverlay: wraps arbitrary
// content and shows transient toast strips (title, optional action button, close
// affordance) layered over the bottom of its own bounds.
//
// A toast is an `Adw.Toast` and goes in through `add_toast(toast)`, exactly as on GTK, so a
// GNOME app's toast code runs here unchanged. The QUEUE — one toast at a time, priority,
// re-add, auto-dismiss — is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as
// {@link ToastOverlayQueue}; this element keeps only the DOM half: build the strip on
// `onShow`, tear it down on `onHide`, run the enter/exit transitions.
//
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Reference: refs/adwaita-web/adwaita-web/scss/_toast.scss, _toast_overlay.scss
// Reference: refs/libadwaita/src/adw-toast-overlay.c, adw-toast-widget.c (add_toast queues,
//   one toast is shown at a time, the button emits button-clicked, activates the action and
//   dismisses)
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web; the
// queue/auto-dismiss state machine composed from @gjsify/adwaita-core.

import { ToastOverlayQueue } from '@gjsify/adwaita-core';

import { activateWidgetAction } from '../application.js';
import { renderPangoMarkup } from '../pango-markup.js';
import { bindSlottedChildren } from '../slotted-children.js';
import { createGtkImage } from './gtk-image.js';
import type { Toast, ToastScheduler, ToastTimerHandle } from '@gjsify/adwaita-core';

// The timing seam is re-exported so a consumer can type a custom scheduler for
// {@link AdwToastOverlay.scheduler} without depending on the core package.
export type { ToastScheduler, ToastTimerHandle } from '@gjsify/adwaita-core';

/**
 * Fallback budget in ms for the exit transition: must stay at or above the
 * `.adw-toast.hiding` transition-duration in `_toast.scss` (0.15s today), because it
 * only fires when `transitionend` does not.
 */
const TOAST_EXIT_MS = 300;

/** The default timing seam: the browser's own timers. */
const domScheduler: ToastScheduler = {
    schedule: (callback, ms) => setTimeout(callback, ms) as unknown as ToastTimerHandle,
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class AdwToastOverlay extends HTMLElement {
    private _toasts!: HTMLDivElement;
    private _initialized = false;
    /** The headless queue of `adw-toast-overlay.c` (ADR 0004). */
    private readonly _queue: ToastOverlayQueue;
    /** The timing source the queue's auto-dismiss runs on — swappable, see {@link scheduler}. */
    private _scheduler: ToastScheduler = domScheduler;
    /** The strip currently mounted for {@link ToastOverlayQueue.current}, if any. */
    private _currentEl: HTMLDivElement | null = null;

    constructor() {
        super();
        this._queue = new ToastOverlayQueue({
            // Indirect through `this._scheduler` so the timing source stays
            // swappable after construction (the queue takes its scheduler once).
            scheduler: {
                schedule: (callback, ms) => this._scheduler.schedule(callback, ms),
                cancel: (handle) => this._scheduler.cancel(handle),
            },
            onShow: (toast) => this._mountToast(toast),
            // The core queue fires `onHide` BEFORE it shifts the next toast in, so
            // `pending > 0` here means another toast takes this slot immediately: detach
            // without the exit transition, keeping exactly one strip in the DOM. A last
            // toast fades out instead.
            onHide: () => this._unmountToast(this._queue.pending > 0),
        });
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // The children become the wrapped content (Adw.ToastOverlay:child); the toast
        // container is layered over the bottom edge. LIVE, because the overlay is the
        // outermost widget of a window and the app it wraps is very often appended to it
        // after it exists. `src/slotted-children.ts` has the incident.
        const content = document.createElement('div');
        content.className = 'adw-toast-overlay-content';

        this._toasts = document.createElement('div');
        this._toasts.className = 'adw-toast-overlay-toasts';

        bindSlottedChildren(this, [{ into: content }]).install(content, this._toasts);
    }

    /**
     * The timing source driving the queue's auto-dismiss and the exit transition.
     * Defaults to the browser's `setTimeout`/`clearTimeout`; swap it for a
     * deterministic fake to drive toast lifetimes without real timers (the
     * {@link ToastScheduler} seam `@gjsify/adwaita-core` defines).
     */
    get scheduler(): ToastScheduler {
        return this._scheduler;
    }

    set scheduler(scheduler: ToastScheduler) {
        this._scheduler = scheduler;
    }

    /** The toast currently on screen, or `null` when nothing is shown. */
    get currentToast(): Toast | null {
        return this._queue.current;
    }

    /** Number of toasts queued behind the visible one. */
    get pendingToasts(): number {
        return this._queue.pending;
    }

    /** `adw_toast_overlay_add_toast`: show `toast` now, or queue it by its priority. */
    add_toast(toast: Toast): void {
        // Ensure the toast container exists even if add_toast() races a not-yet
        // connected element (mirrors Adw.ToastOverlay queuing before realize).
        if (!this._toasts) this.connectedCallback();
        this._queue.add_toast(toast);
    }

    /** `adw_toast_overlay_dismiss_all`: dismiss every queued toast, then the visible one. */
    dismiss_all(): void {
        this._queue.dismiss_all();
    }

    /** Build + attach the strip for `toast` — the DOM half of the queue's `onShow`. */
    private _mountToast(toast: Toast): void {
        const el = document.createElement('div');
        el.className = 'adw-toast';

        const wrapper = document.createElement('div');
        wrapper.className = 'adw-toast-content-wrapper';

        const titleEl = document.createElement('span');
        titleEl.className = 'adw-toast-title';
        if (toast.use_markup) renderPangoMarkup(titleEl, toast.title);
        else titleEl.textContent = toast.title;
        wrapper.appendChild(titleEl);
        el.appendChild(wrapper);

        if (toast.button_label) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'adw-toast-action-button';
            button.textContent = toast.button_label;
            button.addEventListener('click', () => {
                toast.emit('button-clicked');
                if (toast.action_name) activateWidgetAction(this, toast.action_name);
                toast.dismiss();
            });
            el.appendChild(button);
        }

        // Close affordance — the real `window-close` glyph, which is what upstream puts
        // here (adw-toast-widget.ui:64) and what this port drew with two rotated CSS bars
        // under a comment claiming no such icon shipped. It does, and the toast is the one
        // close button in the package already sized the way upstream sizes it: a 16px
        // symbolic in a 24px circle, so the swap is the name and nothing else.
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'adw-toast-close-button';
        close.setAttribute('aria-label', 'Close');
        close.appendChild(createGtkImage('window-close'));
        close.addEventListener('click', () => toast.dismiss());
        el.appendChild(close);

        this._toasts.appendChild(el);
        this._currentEl = el;

        // Trigger the enter animation on the next frame.
        requestAnimationFrame(() => {
            el.classList.add('visible');
        });
    }

    /**
     * Detach the mounted strip — the DOM half of the queue's `onHide`. `immediate`
     * skips the exit transition because the next queued toast is about to take this
     * slot, which is what keeps exactly one strip mounted.
     */
    private _unmountToast(immediate: boolean): void {
        const el = this._currentEl;
        this._currentEl = null;
        if (!el) return;

        if (immediate) {
            el.remove();
            return;
        }

        el.classList.remove('visible');
        el.classList.add('hiding');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        // Fallback for when transitionend does not fire (reduced motion). Routed through
        // the injected scheduler so the lifecycle stays deterministic under a fake clock.
        this._scheduler.schedule(() => {
            if (el.parentNode) el.remove();
        }, TOAST_EXIT_MS);
    }
}

customElements.define('adw-toast-overlay', AdwToastOverlay);
