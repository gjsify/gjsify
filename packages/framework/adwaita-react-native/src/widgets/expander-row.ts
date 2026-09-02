// `AdwExpanderRow` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwExpanderRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A boxed-list row that discloses further rows beneath itself.
 *
 * THE TWO IMPLEMENTATIONS SHARE ONE DISCLOSURE MACHINE. `expanded` is idempotent — a set
 * to the value already held changes nothing and notifies nobody — and that is GObject's
 * own property gate on GTK and `@gjsify/adwaita-core`'s `ExpanderState` on React Native,
 * the same state machine `@gjsify/adwaita-web`'s `<adw-expander-row>` and
 * `@gjsify/adwaita-nativescript`'s `AdwExpanderRow` compose. So both suites assert the
 * same three transitions rather than each side's own idea of "toggled".
 *
 * AND BOTH KEEP THE COLLAPSED CHILDREN IN THE TREE. GTK puts them under a
 * `Gtk.Revealer`, which leaves them parented and UNMAPPED; the React Native half gives
 * the disclosure `display: 'none'`, which is what the sibling renderers do. Unmounting
 * them instead would look identical on screen and lose every child's state on a
 * collapse.
 */
export function AdwExpanderRow(_props: AdwExpanderRowProps): ReactElement | null {
    return refuseBaseModule('AdwExpanderRow');
}
