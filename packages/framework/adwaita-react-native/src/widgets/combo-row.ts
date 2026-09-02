// `AdwComboRow` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwComboRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A row that picks one item out of a list.
 *
 * THE TWO IMPLEMENTATIONS SHARE THE SELECTION MODEL AND NOTHING ELSE. On GTK the real
 * `Adw.ComboRow` drives a `GtkSingleSelection` over a `Gtk.StringList`; on React Native
 * `@gjsify/adwaita-core`'s `ComboState` — the same index↔value mapping, the same autoselect
 * on a replaced model, the same `n_items > 1` chooser rule — runs in TypeScript. Both sides
 * are asked the same questions with the same options: how many items, which one is
 * selected, and whether the row presents itself as a chooser at all.
 */
export function AdwComboRow(_props: AdwComboRowProps): ReactElement | null {
    return refuseBaseModule('AdwComboRow');
}
