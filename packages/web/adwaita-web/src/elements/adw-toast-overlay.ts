// <adw-toast-overlay> — Adwaita toast notification overlay.
// The web counterpart of Adw.ToastOverlay: it wraps arbitrary content and shows
// transient `.adw-toast` banners (the Adw.Toast equivalent — a title, an
// optional action button and a close affordance) layered over the bottom of its
// own bounds, each auto-dismissing after a timeout.
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Reference: refs/adwaita-web/adwaita-web/scss/_toast.scss, _toast_overlay.scss
// Reference: refs/libadwaita/src/adw-toast-overlay.c, adw-toast.c (Adw.Toast.add_toast)
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
// extended addToast() with action button + close button + options API.

/** Options for {@link AdwToastOverlay.addToast}, mirroring Adw.Toast's properties. */
export interface AdwToastOptions {
    /** Seconds before the toast auto-dismisses; `0` keeps it until dismissed. Mirrors Adw.Toast:timeout (default 5). */
    timeout?: number;
    /** Label for the action button; omitted/empty means no button. Mirrors Adw.Toast:button-label. */
    buttonLabel?: string;
    /** Invoked when the action button is pressed. Mirrors the activation of Adw.Toast:action-name. */
    onAction?: () => void;
}

export class AdwToastOverlay extends HTMLElement {
    private _toasts!: HTMLDivElement;
    private _initialized = false;

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Adopt the declared children as the wrapped content (the Adw.ToastOverlay
        // :child) and layer a dedicated toast container over the bottom edge.
        const content = document.createElement('div');
        content.className = 'adw-toast-overlay-content';
        for (const child of Array.from(this.childNodes)) content.appendChild(child);

        this._toasts = document.createElement('div');
        this._toasts.className = 'adw-toast-overlay-toasts';

        this.replaceChildren(content, this._toasts);
    }

    /**
     * Show a toast notification — the web equivalent of Adw.ToastOverlay.add_toast()
     * with a freshly-built Adw.Toast.
     *
     * @param title   The text to display.
     * @param options Either a timeout in seconds (legacy shorthand) or an
     *                {@link AdwToastOptions} bag (title text already supplied here).
     */
    addToast(title: string, options: number | AdwToastOptions = {}): void {
        // Ensure the toast container exists even if addToast() races a not-yet
        // connected element (mirrors Adw.ToastOverlay queuing before realize).
        if (!this._toasts) this.connectedCallback();

        // Back-compat: the original signature was addToast(title, timeoutMs).
        const opts: AdwToastOptions =
            typeof options === 'number' ? { timeout: options / 1000 } : options;
        const timeoutSeconds = opts.timeout ?? 5;

        const toast = document.createElement('div');
        toast.className = 'adw-toast';

        const wrapper = document.createElement('div');
        wrapper.className = 'adw-toast-content-wrapper';

        const titleEl = document.createElement('span');
        titleEl.className = 'adw-toast-title';
        titleEl.textContent = title;
        wrapper.appendChild(titleEl);
        toast.appendChild(wrapper);

        let dismissTimer = 0;
        const dismiss = (): void => {
            if (dismissTimer) {
                clearTimeout(dismissTimer);
                dismissTimer = 0;
            }
            toast.classList.remove('visible');
            toast.classList.add('hiding');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            // Fallback if transitionend doesn't fire (e.g. reduced motion).
            setTimeout(() => {
                if (toast.parentNode) toast.remove();
            }, 300);
        };

        if (opts.buttonLabel) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'adw-toast-action-button';
            button.textContent = opts.buttonLabel;
            button.addEventListener('click', () => {
                opts.onAction?.();
                dismiss();
            });
            toast.appendChild(button);
        }

        // Close affordance — a CSS-drawn "×" (no symbolic close icon ships in the
        // curated @gjsify/adwaita-icons set), mirroring adw-tab-view's .adw-tab-close.
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'adw-toast-close-button';
        close.setAttribute('aria-label', 'Close');
        close.addEventListener('click', dismiss);
        toast.appendChild(close);

        this._toasts.appendChild(toast);

        // Trigger the enter animation on the next frame.
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        // Auto-dismiss after the timeout (0 = stay until manually dismissed).
        if (timeoutSeconds > 0) {
            dismissTimer = setTimeout(dismiss, timeoutSeconds * 1000) as unknown as number;
        }
    }
}

customElements.define('adw-toast-overlay', AdwToastOverlay);
