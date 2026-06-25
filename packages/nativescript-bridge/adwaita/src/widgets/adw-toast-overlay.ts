// AdwToast + AdwToastOverlay — Libadwaita-style transient snackbars for NativeScript.
//
// `AdwToastOverlay` renders a REAL NativeScript `GridLayout` overlaying a content
// layer with a bottom-anchored toast strip. `showToast()` shows a transient
// message at the bottom that auto-dismisses after a timeout. Mirrors
// `Adw.ToastOverlay` + `Adw.Toast`: `addToast(toast)` / `showToast(title, opts)`,
// optional action button (`buttonLabel` + `buttonClicked`).
//
// FIDELITY: compromised on the animation/scrim only. NS has no z-index /
// box-shadow / slide-transition in this CSS subset, so the toast is bottom-aligned
// within the grid and toggled by `visibility` (instant appear/disappear, NO
// slide-up animation). The strip LOOK (rounded dark pill + label + optional
// action) and the timed auto-dismiss + action-button behaviour are faithful. Uses
// the NS `setTimeout` global for the dismiss timer.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-toast-overlay`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_toast.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Button, GridLayout, ItemSpec, Label, View, type EventData } from '@nativescript/core';

/** Default toast lifetime, in milliseconds (Adwaita's default ≈ 5 s). */
export const DEFAULT_TOAST_TIMEOUT = 5000;

/** Event name emitted when a toast's action button is tapped. */
export const TOAST_BUTTON_CLICKED = 'toastButtonClicked';

/** Options for {@link AdwToastOverlay.showToast}. */
export interface AdwToastOptions {
    /** Auto-dismiss timeout in ms (0 = no auto-dismiss). Default {@link DEFAULT_TOAST_TIMEOUT}. */
    timeout?: number;
    /** Optional action button label. */
    buttonLabel?: string;
}

/**
 * A single transient toast descriptor. Mirrors `Adw.Toast` — a value object
 * (title + optional action) handed to {@link AdwToastOverlay.addToast}.
 */
export class AdwToast {
    /** The toast message. */
    title: string;
    /** Auto-dismiss timeout in ms (0 = sticky). */
    timeout: number;
    /** Optional action button label (empty = no button). */
    buttonLabel: string;

    constructor(title = '', options: AdwToastOptions = {}) {
        this.title = title;
        this.timeout = options.timeout ?? DEFAULT_TOAST_TIMEOUT;
        this.buttonLabel = options.buttonLabel ?? '';
    }
}

export class AdwToastOverlay extends GridLayout {
    /** The always-visible content layer. */
    private _content: View | null = null;
    /** The bottom-anchored toast strip. */
    protected readonly _toastStrip: GridLayout;
    protected readonly _toastLabel: Label;
    protected readonly _toastButton: Button;
    private _hasButton = false;
    private _dismissTimer: ReturnType<typeof setTimeout> | null = null;

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
            this._dismiss();
        });
        this._toastButton = button;

        this.addChild(strip);
        this._toastStrip = strip;
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

    /** Show a {@link AdwToast} descriptor. */
    addToast(toast: AdwToast): void {
        this.showToast(toast.title, { timeout: toast.timeout, buttonLabel: toast.buttonLabel });
    }

    /** Show a transient toast with the given message and options. */
    showToast(title: string, options: AdwToastOptions = {}): void {
        if (this._dismissTimer) {
            clearTimeout(this._dismissTimer);
            this._dismissTimer = null;
        }
        this._toastLabel.text = title ?? '';

        const buttonLabel = options.buttonLabel ?? '';
        const wantButton = buttonLabel.length > 0;
        if (wantButton) {
            this._toastButton.text = buttonLabel;
            if (!this._hasButton) {
                this._toastStrip.addChild(this._toastButton);
                this._hasButton = true;
            }
        } else if (this._hasButton) {
            this._toastStrip.removeChild(this._toastButton);
            this._hasButton = false;
        }

        this._toastStrip.visibility = 'visible';

        const timeout = options.timeout ?? DEFAULT_TOAST_TIMEOUT;
        if (timeout > 0) {
            this._dismissTimer = setTimeout(() => this._dismiss(), timeout);
        }
    }

    /** Dismiss the current toast immediately. */
    dismiss(): void {
        this._dismiss();
    }

    private _dismiss(): void {
        if (this._dismissTimer) {
            clearTimeout(this._dismissTimer);
            this._dismissTimer = null;
        }
        this._toastStrip.visibility = 'collapse';
    }

    /** Whether a toast is currently shown. */
    get visible(): boolean {
        return this._toastStrip.visibility === 'visible';
    }
}
