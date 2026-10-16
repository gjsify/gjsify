// AdwToastOverlay — Libadwaita-style transient snackbars for NativeScript.
//
// A toast is an `Adw.Toast` (`@gjsify/adwaita-core`) and goes in through
// `add_toast(toast)`, exactly as on GTK, so a GNOME app's toast code runs here
// unchanged. The QUEUE — one toast at a time, priority, re-add, auto-dismiss — is
// HEADLESS and lives in the core as `ToastOverlayQueue` (ADR 0004); this module keeps
// only the NativeScript binding: a REAL `GridLayout` overlaying a content layer with a
// bottom-anchored toast strip, the `setTimeout`-backed scheduler, and the CSS.
//
// The action button does what `adw-toast-widget.c` does: emit `button-clicked`,
// activate `action-name` if set, dismiss the toast.
//
// The old `AdwToast` value object and `AdwToastQueue` stay re-exported: they are the
// millisecond surface `@gjsify/adwaita-react-native`'s ref handle takes.
//
// FIDELITY: compromised on the animation/scrim only. NS has no z-index /
// box-shadow / slide-transition in this CSS subset, so the toast is bottom-aligned
// within the grid and toggled by `visibility` (instant appear/disappear, NO
// slide-up animation). A `use-markup` title shows its plain text, as `Adw.Banner`'s.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-toast-overlay`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (Toasts),
//   src/adw-toast-overlay.c, src/adw-toast-widget.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { Button, GridLayout, ItemSpec, Label } from '@nativescript/core';
import { ToastOverlayQueue } from '@gjsify/adwaita-core';
import type { Toast, ToastScheduler } from '@gjsify/adwaita-core';
import { activateWidgetAction } from './actions.js';
import { bannerTitleText } from './chrome.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

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

/** The NativeScript timing seam for the core queue's auto-dismiss (its `setTimeout`/`clearTimeout`). */
const nativeScriptScheduler: ToastScheduler = {
    schedule: (callback, ms) => setTimeout(callback, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class AdwToastOverlay extends withSignals(GridLayout) {
    static readonly GTypeName: string = 'AdwToastOverlay';

    /** The always-visible content layer. */
    private _content: View | null = null;
    /** The bottom-anchored toast strip. */
    protected readonly _toastStrip: GridLayout;
    protected readonly _toastLabel: Label;
    protected readonly _toastButton: Button;
    private _hasButton = false;
    /** The headless queue of `adw-toast-overlay.c` (ADR 0004). */
    private readonly _queue: ToastOverlayQueue;

    constructor(props?: ConstructProps<AdwToastOverlay>) {
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
            const toast = this._queue.current;
            if (!toast) return;
            toast.emit('button-clicked');
            if (toast.action_name) activateWidgetAction(this, toast.action_name);
            toast.dismiss();
        });
        this._toastButton = button;

        this.addChild(strip);
        this._toastStrip = strip;

        // The renderer feeds timing + render into the headless queue: `onShow`
        // mounts the strip, `onHide` collapses it, the scheduler drives auto-dismiss.
        this._queue = new ToastOverlayQueue({
            scheduler: nativeScriptScheduler,
            onShow: (toast) => this._renderStrip(toast),
            onHide: () => {
                this._toastStrip.visibility = 'collapse';
            },
        });

        applyConstructProps(this, props);
    }

    /** Set (or replace) the always-visible content layer (under the toast) — `adw_toast_overlay_set_child`. */
    set_child(view: View | null): void {
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

    /** The always-visible content layer, or `null` — `Adw.ToastOverlay:child`. */
    get child(): View | null {
        return this._content;
    }

    /**
     * `Adw.ToastOverlay:child` — {@link set_child} under the property spelling the
     * counterpart declares, so the overlay's one slot can arrive in a construct-props
     * bag instead of a second statement.
     */
    set child(view: View | null) {
        this.set_child(view);
    }

    /** `adw_toast_overlay_add_toast`: show `toast` now, or queue it by its priority. */
    add_toast(toast: Toast): void {
        this._queue.add_toast(toast);
    }

    /** `adw_toast_overlay_dismiss_all`: dismiss every queued toast, then the visible one. */
    dismiss_all(): void {
        this._queue.dismiss_all();
    }

    /** Mount `toast` as the visible strip — the NS render half of the queue's `onShow`. */
    private _renderStrip(toast: Toast): void {
        this._toastLabel.text = bannerTitleText(toast.title, toast.use_markup);

        if (toast.button_label) {
            this._toastButton.text = toast.button_label;
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

    /**
     * Whether a toast is currently shown. Not `visible`: that is `GtkWidget:visible`, every
     * widget's own show/hide switch (`widget-layout.ts`), and a read-only getter here would
     * have taken its setter away from this class.
     */
    get toastShowing(): boolean {
        return this._queue.current !== null;
    }
}
