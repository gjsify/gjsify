// `AdwSpinRow` — the base module. See `../refuse.ts` for who reaches this and why it throws
// instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwSpinRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A row holding a number with a stepper.
 *
 * THE TWO IMPLEMENTATIONS SHARE THE CLAMP AND NOTHING ELSE. On GTK a real `Gtk.Adjustment`
 * bounds the value in C; on React Native `@gjsify/adwaita-core`'s `SpinState` — the same
 * clamp on every mutation, the same re-clamp when a bound moves under a value — runs in
 * TypeScript. Both suites assert the same number for the same authored range, including the
 * two cases a naive port gets wrong: a value authored OUTSIDE the range, and a stepper press
 * that would leave it.
 */
export function AdwSpinRow(_props: AdwSpinRowProps): ReactElement | null {
    return refuseBaseModule('AdwSpinRow');
}
