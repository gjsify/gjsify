// The plain libadwaita enums an application reads off `Adw` on a target that has no GI.
//
// `Adw.ResponseAppearance` is what `Adw.AlertDialog.set_response_appearance` takes in GJS
// (`Adw.ResponseAppearance.DESTRUCTIVE`). The headless dialog model holds the nick, so a
// write resolves the constant to it here and a read answers the nick, like `halign` does.
// `scripts/check-nativescript-xml-doors.mjs` arm 8 holds the list against the typelib.
//
// Reference: refs/libadwaita src/adw-message-dialog.h (AdwResponseAppearance)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwResponseAppearance } from '@gjsify/adwaita-core';
import { tableOf } from './enum-table.js';
import { transitionNick } from './transition-type.js';

/** `Adw.ResponseAppearance`'s nicks, in the enum's order (DEFAULT=0, SUGGESTED=1, DESTRUCTIVE=2). */
export const ADW_RESPONSE_APPEARANCES = ['default', 'suggested', 'destructive'] as const;

/** `Adw.ResponseAppearance`: `DEFAULT` 0, `SUGGESTED` 1, `DESTRUCTIVE` 2. */
export const ResponseAppearance = tableOf(ADW_RESPONSE_APPEARANCES);

/** The nick a response appearance write means: a nick or the constant, or throw naming the members. */
export function responseAppearance(value: unknown): AdwResponseAppearance {
    return transitionNick(value, ADW_RESPONSE_APPEARANCES, 'Adw.ResponseAppearance');
}
