// @gjsify/adwaita-app — promise-based Adw.AlertDialog helpers.
// `Adw.AlertDialog` is response-signal based; these wrap it so a caller can
// `await` a confirm/error without threading a callback through the UI.

import Adw from '@girs/adw-1';
import type Gtk from '@girs/gtk-4.0';

import { resolveDefaultResponse } from './dialog-model.js';
import type { ConfirmResponse } from './types.js';

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
    /**
     * Response the dialog opens focused on, so Enter activates it. Default `confirm`.
     *
     * Pair `cancel` with `destructive`: what makes a "really delete this?" dialog
     * worth showing is the accidental gesture, and a `confirm` default hands the
     * reflex of dismissing a dialog with Enter the deletion instead of the escape.
     */
    defaultResponse?: ConfirmResponse;
}

/**
 * Present a confirm/cancel `Adw.AlertDialog`; resolves `true` on confirm, `false`
 * on cancel/dismiss. `parent` anchors the dialog (typically the window).
 */
export function confirmDialog(parent: Gtk.Widget, options: ConfirmOptions): Promise<boolean> {
    // An invalid option is a caller bug, not a dialog outcome: validated outside
    // the executor so it throws at the call site instead of arriving as a
    // rejection on the channel that reports the user's answer.
    const defaultResponse = resolveDefaultResponse(options.defaultResponse);
    return new Promise((resolve) => {
        const dialog = new Adw.AlertDialog({ heading: options.heading, body: options.body ?? '' });
        dialog.add_response('cancel', options.cancelLabel ?? 'Cancel');
        dialog.add_response('confirm', options.confirmLabel ?? 'OK');
        dialog.set_response_appearance(
            'confirm',
            options.destructive ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED,
        );
        dialog.set_default_response(defaultResponse);
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => resolve(response === 'confirm'));
        dialog.present(parent);
    });
}

/**
 * Present a single-button error `Adw.AlertDialog`; resolves when dismissed.
 *
 * `okLabel` exists for the same reason {@link ConfirmOptions} carries `cancelLabel` and
 * `confirmLabel`: this is library code with no text domain of its own, so a caption it hardcodes is
 * one no application can translate. The English default stays as the fallback — an app that passes
 * nothing gets "OK", which is at least honest about being untranslated rather than untranslatable.
 */
export function errorDialog(parent: Gtk.Widget, heading: string, body?: string, okLabel?: string): Promise<void> {
    return new Promise((resolve) => {
        const dialog = new Adw.AlertDialog({ heading, body: body ?? '' });
        dialog.add_response('ok', okLabel ?? 'OK');
        dialog.set_default_response('ok');
        dialog.set_close_response('ok');
        dialog.connect('response', () => resolve());
        dialog.present(parent);
    });
}
