// <adw-toast-overlay> — Adwaita toast notification overlay.
// Displays temporary feedback messages at the bottom of the viewport.
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Reference: refs/adwaita-web/adwaita-web/scss/_toast.scss, _toast_overlay.scss
// Reference: refs/libadwaita/src/adw-toast-overlay.c
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web.

export class AdwToastOverlay extends HTMLElement {
    /**
     * Show a toast notification.
     * @param title - The text to display.
     * @param timeout - Time in ms before the toast auto-dismisses (default 2000).
     */
    addToast(title: string, timeout = 2000): void {
        const toast = document.createElement('div');
        toast.className = 'adw-toast';

        const titleEl = document.createElement('span');
        titleEl.className = 'adw-toast-title';
        titleEl.textContent = title;
        toast.appendChild(titleEl);

        this.appendChild(toast);

        // Trigger enter animation on next frame
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        // Auto-dismiss after timeout
        setTimeout(() => {
            toast.classList.remove('visible');
            toast.classList.add('hiding');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            // Fallback if transitionend doesn't fire
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
        }, timeout);
    }
}

customElements.define('adw-toast-overlay', AdwToastOverlay);
