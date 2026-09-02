// `AdwActionRow` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwActionRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A boxed-list row with a title, a subtitle and a trailing slot.
 *
 * THE TWO IMPLEMENTATIONS SHARE THEIR LABEL RULE AND NOTHING ELSE. libadwaita binds
 * `string_is_not_empty` onto both labels, so an empty title hides its label rather than
 * leaving a blank line; on GTK the real `Adw.ActionRow` applies that binding in C, and on
 * React Native `@gjsify/adwaita-core`'s `deriveRowLabels` — the same call
 * `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` make — applies it in
 * TypeScript. Both suites assert the same four outputs of it rather than each side's own
 * idea of "the subtitle is empty".
 */
export function AdwActionRow(_props: AdwActionRowProps): ReactElement | null {
    return refuseBaseModule('AdwActionRow');
}
