// AdwToast + AdwToastOverlay — Libadwaita-style transient snackbars for NativeScript.
//
// The QUEUE — `Adw.ToastOverlay`'s one-at-a-time policy + ordering + the
// auto-dismiss lifecycle state machine — plus the `AdwToast` value object are
// HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004); this module re-exports
// them unchanged (no consumer-visible move) and keeps only the NativeScript
// binding: a REAL `GridLayout` overlaying a content layer with a bottom-anchored
// toast strip, the `setTimeout`-backed scheduler that drives the core queue's
// auto-dismiss, and the CSS.
//
// `AdwToastOverlay` drives an {@link AdwToastQueue}: `addToast(toast)` /
// `showToast(title, opts)` enqueue; the queue shows one at a time and calls back
// to mount/tear-down the strip (`onShow`/`onHide`), with the injected scheduler
// firing the auto-dismiss. Optional action button (`buttonLabel` +
// `toastButtonClicked` event) dismisses the current toast and advances the queue.
//
// FIDELITY: compromised on the animation/scrim only. NS has no z-index /
// box-shadow / slide-transition in this CSS subset, so the toast is bottom-aligned
// within the grid and toggled by `visibility` (instant appear/disappear, NO
// slide-up animation). The strip LOOK (rounded dark pill + label + optional
// action) and the queued, timed auto-dismiss + action-button behaviour are faithful.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-toast-overlay`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (Toasts)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Button, GridLayout, ItemSpec, Label, View, type EventData } from '@nativescript/core';
import { AdwToast, AdwToastQueue } from '@gjsify/adwaita-core';
import type { AdwToastOptions, ToastScheduler } from '@gjsify/adwaita-core';

// Re-export the headless surface so existing consumers keep importing it from
// `@gjsify/adwaita-nativescript` unchanged.
export { AdwToast, AdwToastQueue, DEFAULT_TOAST_TIMEOUT } from '@gjsify/adwaita-core';
export type {
    AdwToastOptions,
    AdwToastQueueHandlers,
    AdwToastQueueOptions,
    ToastScheduler,
    ToastTimerHandle,
} from '@gjsify/adwaita-core';

/** Event name emitted when a toast's action button is tapped. */
export const TOAST_BUTTON_CLICKED = 'toastButtonClicked';

/** The NativeScript timing seam for the core queue's auto-dismiss (its `setTimeout`/`clearTimeout`). */
const nativeScriptScheduler: ToastScheduler = {
    schedule: (callback, ms) => setTimeout(callback, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class AdwToastOverlay extends GridLayout {
    /** The always-visible content layer. */
    private _content: View | null = null;
    /** The bottom-anchored toast strip. */
    protected readonly _toastStrip: GridLayout;
    protected readonly _toastLabel: Label;
    protected readonly _toastButton: Button;
    private _hasButton = false;
    /** The headless one-at-a-time + auto-dismiss state machine (ADR 0004). */
    private readonly _queue: AdwToastQueue;

    constructor() {
        super();

        this.className = 'adw-toast-overlay';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        const strip = new GridLayout();
        strip.className = 'adw-toast';
        strip.visibility = 'collapse';
        strip.verticalAlignment = 'bottom';
        strip.horizontalAlignment = 'center';
        strip.addColumn(new ItemSpec(1, 'star'));
        strip.addColumn(new ItemSpec(1, 'auto'));
        strip.addRow(new ItemSpec(1, 'auto'));
        GridLayout.setColumn(strip, 0);
        GridLayout.setRow(strip, 0);

        const label = new Label();
        label.className = 'adw-toast-title';
        label.textWrap = true;
        GridLayout.setColumn(label, 0);
        strip.addChild(label);
        this._toastLabel = label;

        const button = new Button();
        button.className = 'adw-toast-button';
        button.set('androidElevation', 0);
        GridLayout.setColumn(button, 1);
        button.addEventListener('tap', () => {
            const data: EventData = { eventName: TOAST_BUTTON_CLICKED, object: this };
            this.notify(data);
            this._queue.dismiss();
        });
        this._toastButton = button;

        this.addChild(strip);
        this._toastStrip = strip;

        // The renderer feeds timing + render into the headless queue: `onShow`
        // mounts the strip, `onHide` collapses it, the scheduler drives auto-dismiss.
        this._queue = new AdwToastQueue({
            scheduler: nativeScriptScheduler,
            onShow: (toast) => this._renderStrip(toast),
            onHide: () => {
                this._toastStrip.visibility = 'collapse';
            },
        });
    }

    /** Set (or replace) the always-visible content layer (under the toast). */
    setContent(view: View | null): void {
        if (this._content) this.removeChild(this._content);
        this._content = view;
        if (view) {
            view.className = `${view.className ?? ''} adw-toast-overlay-content`.trim();
            GridLayout.setColumn(view, 0);
            GridLayout.setRow(view, 0);
            // Insert BELOW the toast strip so the strip paints on top.
            this.insertChild(view, 0);
        }
    }

    /** Enqueue a {@link AdwToast} descriptor (shows now, or after the current one). */
    addToast(toast: AdwToast): void {
        this._queue.add(toast);
    }

    /** Enqueue a transient toast with the given message and options. */
    showToast(title: string, options: AdwToastOptions = {}): void {
        this._queue.add(new AdwToast(title ?? '', options));
    }

    /** Dismiss the current toast immediately (advances to the next queued one). */
    dismiss(): void {
        this._queue.dismiss();
    }

    /** Mount `toast` as the visible strip — the NS render half of the queue's `onShow`. */
    private _renderStrip(toast: AdwToast): void {
        this._toastLabel.text = toast.title;

        if (toast.hasButton) {
            this._toastButton.text = toast.buttonLabel;
            if (!this._hasButton) {
                this._toastStrip.addChild(this._toastButton);
                this._hasButton = true;
            }
        } else if (this._hasButton) {
            this._toastStrip.removeChild(this._toastButton);
            this._hasButton = false;
        }

        this._toastStrip.visibility = 'visible';
    }

    /** Whether a toast is currently shown. */
    get visible(): boolean {
        return this._queue.showing;
    }
}
