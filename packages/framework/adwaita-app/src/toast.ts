// @gjsify/adwaita-app — app-wide toast helper.
// Register the window's Adw.ToastOverlay once, then any view can toast without
// threading the overlay through every constructor.

import Adw from 'gi://Adw?version=1';

let overlay: Adw.ToastOverlay | null = null;

/** Register the active window's toast overlay. Call once, at window build. */
export function registerToastOverlay(toastOverlay: Adw.ToastOverlay): void {
    overlay = toastOverlay;
}

/**
 * Show a toast on the registered overlay. No-ops with a warning if
 * {@link registerToastOverlay} has not been called yet.
 *
 * @param timeout auto-dismiss seconds; `0` = sticky. Default `3`.
 */
export function showToast(title: string, timeout = 3): void {
    if (!overlay) {
        console.warn('@gjsify/adwaita-app: showToast() before registerToastOverlay()');
        return;
    }
    overlay.add_toast(new Adw.Toast({ title, timeout }));
}
