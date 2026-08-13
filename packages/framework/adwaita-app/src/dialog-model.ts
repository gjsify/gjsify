// @gjsify/adwaita-app — pure confirm-dialog model.
// No @girs imports: unit-tested on Node + GJS, unlike the Adw wrapper it serves.

import type { ConfirmResponse } from './types.js';

function isConfirmResponse(value: string): value is ConfirmResponse {
    return value === 'confirm' || value === 'cancel';
}

/**
 * Resolve which response a confirm dialog opens focused on — the one Enter picks.
 *
 * Falls back to `confirm`, which is what every caller of the option-less API
 * already gets; changing that default would change published behaviour under
 * consumers who never asked for it.
 *
 * The id is checked at RUNTIME, not just by the union: the type is erased, and
 * `adw_alert_dialog_set_default_response()` takes any string — an id matching no
 * response stores the quark and never touches the default widget, so a typo
 * ships as a dialog where Enter quietly does nothing.
 *
 * @throws TypeError for an id the dialog has no response for.
 */
export function resolveDefaultResponse(requested?: string): ConfirmResponse {
    if (requested === undefined) return 'confirm';
    if (!isConfirmResponse(requested)) {
        throw new TypeError(
            `@gjsify/adwaita-app: confirmDialog defaultResponse must be 'confirm' or 'cancel', got ${JSON.stringify(requested)}`,
        );
    }
    return requested;
}
