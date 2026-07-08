// @gjsify/adwaita-app — promise-based Adw.AlertDialog helpers.
// `Adw.AlertDialog` is response-signal based; these wrap it so a caller can
// `await` a confirm/error without threading a callback through the UI.

import Adw from '@girs/adw-1';
import type Gtk from '@girs/gtk-4.0';

/** Options for {@link confirmDialog}. */
export interface ConfirmOptions {
    /** Dialog heading. */
    heading: string;
    /** Body text under the heading. */
    body?: string;
    /** Confirm-button label. Default `OK`. */
    confirmLabel?: string;
    /** Cancel-button label. Default `Cancel`. */
    cancelLabel?: string;
    /** Style the confirm button as destructive (red) instead of suggested. */
    destructive?: boolean;
}

/**
 * Present a confirm/cancel `Adw.AlertDialog`; resolves `true` on confirm, `false`
 * on cancel/dismiss. `parent` anchors the dialog (typically the window).
 */
export function confirmDialog(parent: Gtk.Widget, options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        const dialog = new Adw.AlertDialog({ heading: options.heading, body: options.body ?? '' });
        dialog.add_response('cancel', options.cancelLabel ?? 'Cancel');
        dialog.add_response('confirm', options.confirmLabel ?? 'OK');
        dialog.set_response_appearance(
            'confirm',
            options.destructive ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED,
        );
        dialog.set_default_response('confirm');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => resolve(response === 'confirm'));
        dialog.present(parent);
    });
}

/** Present a single-button error `Adw.AlertDialog`; resolves when dismissed. */
export function errorDialog(parent: Gtk.Widget, heading: string, body?: string): Promise<void> {
    return new Promise((resolve) => {
        const dialog = new Adw.AlertDialog({ heading, body: body ?? '' });
        dialog.add_response('ok', 'OK');
        dialog.set_default_response('ok');
        dialog.set_close_response('ok');
        dialog.connect('response', () => resolve());
        dialog.present(parent);
    });
}
