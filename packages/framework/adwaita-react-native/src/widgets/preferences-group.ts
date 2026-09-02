// `AdwPreferencesGroup` — the base module. See `../refuse.ts` for who reaches this and why
// it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwPreferencesGroupProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A titled card of preference rows.
 *
 * THE TWO IMPLEMENTATIONS SHARE THEIR ARITHMETIC AND NOTHING ELSE. On GTK libadwaita runs
 * `update_title_visibility`, `update_description_visibility`, `update_header_visibility`,
 * `is_single_line` and `update_listbox_visibility` in C; on React Native
 * `@gjsify/adwaita-core`'s `derivePreferencesGroupHeader` — one function that answers all
 * five — runs them in TypeScript. Both suites assert the same five answers for the same
 * inputs rather than each side's own idea of "the header is showing".
 */
export function AdwPreferencesGroup(_props: AdwPreferencesGroupProps): ReactElement | null {
    return refuseBaseModule('AdwPreferencesGroup');
}
