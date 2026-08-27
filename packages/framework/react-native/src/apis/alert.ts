// `Alert` — an `Adw.AlertDialog`, and the reason it is buildable while `Modal` is not.
//
// READ THE `Modal` ENTRY FIRST. `Modal` is `planned` because an `Adw.Dialog` cannot be
// an ordinary ELEMENT: measured on libadwaita 1.10, `box.append(dialog)` calls
// `g_error()` — SIGABRT and a core dump, not a catchable exception — when the box is
// rooted in a window. A host inserts an element by calling its parent's adder, so
// there is no way to render `<Modal>` without making that call.
//
// `Alert` never makes it. MEASURED on libadwaita 1.9.3, from a plain function with no
// element, no parent widget and no window anywhere: `new Adw.AlertDialog({heading,
// body})`, three `add_response` calls, `set_response_appearance`,
// `set_close_response`, `set_default_response`, then `present(null)` — returned
// without throwing and with no diagnostic, and `close()` afterwards likewise. A
// dialog is PRESENTED AGAINST a parent, never parented BY one, and `present`'s
// argument is optional; so the difference between the two entries is not the widget,
// it is that one API is a function call and the other is a child insertion.
//
// (Also measured, and it is the same fact from the other side: `present(loose)` with a
// detached `Gtk.Box` as the parent worked too. The parent is a place to anchor, not an
// adopter.)
//
// THE BUTTON STYLES MAP EXACTLY. `Adw.ResponseAppearance` is DEFAULT=0, SUGGESTED=1,
// DESTRUCTIVE=2 (measured), and React Native's three `style` values are `'default'`,
// `'cancel'` and `'destructive'` — so `destructive` is Adwaita's own DESTRUCTIVE, and
// `cancel` is the CLOSE RESPONSE, which is a stronger statement than an appearance:
// it is the response Escape and the compositor's close both produce, which is exactly
// what a cancel button means.
//
// Values through `gi://`, types through `@girs/*`.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { PrimitiveError } from '../primitives/errors.js';

/** React Native's own button descriptor. */
export interface AlertButton {
    readonly text?: string;
    readonly onPress?: () => void;
    readonly style?: 'default' | 'cancel' | 'destructive';
    /** Carried for parity and unused: a `Gtk.Entry` inside a dialog is `Alert.prompt`, which is iOS-only. */
    readonly isPreferred?: boolean;
}

export interface AlertOptions {
    /** Whether tapping outside dismisses it — Adwaita's `can-close`, which is the same idea. */
    readonly cancelable?: boolean;
    readonly onDismiss?: () => void;
}

/**
 * The widget an alert is anchored to, or null.
 *
 * The mapped toplevel, for the reason `apis/display.ts` reads the same list: an
 * anchored dialog is modal to ITS window and moves with it, and the window the user is
 * looking at is the mapped one. `null` is a working answer (measured), so a missing
 * window is not an error — it makes the dialog its own toplevel, which is what a
 * command-line tool that alerts before opening a window should get.
 */
function anchor(): Gtk.Widget | null {
    const toplevels = Gtk.Window.get_toplevels();
    for (let index = 0; index < toplevels.get_n_items(); index++) {
        const window = toplevels.get_item(index) as Gtk.Window | null;
        if (window !== null && window.get_mapped()) return window;
    }
    return null;
}

/** `Adw.ResponseAppearance` for a React Native button style. */
const appearanceOf = (style: AlertButton['style']): Adw.ResponseAppearance =>
    style === 'destructive' ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.DEFAULT;

export const Alert = {
    /**
     * Present a dialog with up to as many buttons as were given.
     *
     * `buttons` follows React Native's own defaulting: none given means one OK button,
     * because a dialog with no way out is not a thing to ship. Beyond that the mapping
     * is one response per button, in order, and the response IDs are positional
     * (`response-0`, …) rather than derived from the label — two buttons labelled the
     * same would otherwise collide into one response, silently losing a callback.
     *
     * THE FIRST NON-CANCEL BUTTON BECOMES THE DEFAULT RESPONSE, which is Adwaita's
     * convention (Return activates it) and has no counterpart in React Native's model,
     * where a phone has no Return key. Stated here because it is a decision, not a
     * mapping.
     *
     * `onDismiss` is wired to `Adw.Dialog::closed` and not to `response`: measured,
     * `Adw.AlertDialog` emits `response` and `Adw.Dialog` emits `closed` and
     * `close-attempt`, and a dialog dismissed with Escape produces the close response
     * — so `closed` is the one signal that fires however it went away.
     */
    alert(title: string, message?: string, buttons?: readonly AlertButton[], options?: AlertOptions): void {
        const dialog = new Adw.AlertDialog({
            heading: title,
            ...(message === undefined ? {} : { body: message }),
        });
        if (options?.cancelable === false) dialog.canClose = false;

        const list = buttons === undefined || buttons.length === 0 ? [{ text: 'OK' } as AlertButton] : buttons;
        const handlers = new Map<string, () => void>();
        let defaultResponse: string | null = null;
        list.forEach((button, index) => {
            const id = `response-${index}`;
            dialog.add_response(id, button.text ?? `Button ${index + 1}`);
            dialog.set_response_appearance(id, appearanceOf(button.style));
            if (button.onPress !== undefined) handlers.set(id, button.onPress);
            if (button.style === 'cancel') dialog.set_close_response(id);
            else defaultResponse ??= id;
        });
        if (defaultResponse !== null) dialog.set_default_response(defaultResponse);

        // Disconnected from inside the handlers, both of them: a dialog is presented
        // once and answered once, and a connection left behind is one GJS blocks
        // during GC (the sweeping-phase critical this milestone measured elsewhere).
        const responseHandler = dialog.connect('response', (_dialog, response: string) => {
            dialog.disconnect(responseHandler);
            handlers.get(response)?.();
        });
        if (options?.onDismiss !== undefined) {
            const closedHandler = dialog.connect('closed', () => {
                dialog.disconnect(closedHandler);
                options.onDismiss?.();
            });
        }
        dialog.present(anchor());
    },

    /**
     * Refused by name: it is iOS-only, and the reason is not the platform.
     *
     * `Alert.prompt` puts a text field in the dialog. `Adw.AlertDialog` has an
     * `extra-child` property that would hold a `Gtk.Entry`, so the widget half exists
     * — what does not exist is React Native's contract for it: `prompt` has four
     * overloads, a `keyboardType`, a login/password variant, and callbacks whose
     * arity depends on the type. Building a subset of that would answer some calls and
     * silently mis-answer others. Present your own dialog with an `extra-child`.
     */
    prompt(): never {
        throw new PrimitiveError(
            'Alert',
            'prompt',
            'is iOS-only in React Native, and its contract — four overloads, a login/password variant, and a callback whose arity depends on the type — is what makes it a refusal rather than a port. `Adw.AlertDialog:extra-child` holds a `Gtk.Entry`, so build the dialog you actually want',
        );
    },
} as const;
