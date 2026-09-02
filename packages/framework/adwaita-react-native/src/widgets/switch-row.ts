// `AdwSwitchRow` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwSwitchRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A boxed-list row whose trailing control is a switch.
 *
 * THE WHOLE ROW IS THE CONTROL, not just the handle. `adw_switch_row_init` makes the row
 * activatable and points its activatable-widget at the slider, and the class
 * documentation states the outcome directly: "the user can control the switch by
 * activating the row or by dragging on the switch handle". Both halves therefore have two
 * routes into one transition, and both run them through
 * `@gjsify/adwaita-core`'s `SwitchRowState` — `activate()` for the row, `setActive()` for
 * the slider — so the `g_object_notify` gate on the second is the same gate on the first.
 */
export function AdwSwitchRow(_props: AdwSwitchRowProps): ReactElement | null {
    return refuseBaseModule('AdwSwitchRow');
}
