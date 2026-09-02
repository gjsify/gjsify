// `AdwWindowTitle` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwWindowTitleProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A title over a subtitle, for the centre of a header bar.
 *
 * THE VISIBILITY RULE IS THE WIDGET. `adw_window_title_set_title` binds each label's
 * `visible` to `string_is_not_empty` (adw-window-title.ui:15, the closure at
 * adw-window-title.c:207) — one byte, never trimmed — so an empty title does not reserve
 * a blank line and a title of three spaces does. Both halves take that decision from
 * `@gjsify/adwaita-core`'s `WindowTitleState`/`deriveRowLabels`, the same call
 * `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` make; on GTK the real widget
 * makes it in C and the suite reads it back off the live labels.
 */
export function AdwWindowTitle(_props: AdwWindowTitleProps): ReactElement | null {
    return refuseBaseModule('AdwWindowTitle');
}
