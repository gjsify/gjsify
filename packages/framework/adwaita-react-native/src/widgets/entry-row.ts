// `AdwEntryRow` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwEntryRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A boxed-list row that is itself a text entry.
 *
 * THE TWO IMPLEMENTATIONS SHARE A TRUTH TABLE. `Adw.EntryRow` looks like layout and is
 * almost none: `update_empty` is a five-output derivation over four inputs (text length ·
 * editing · editable · the `text_changed` apply latch), and Enter dispatches to exactly
 * one of two signals depending on that latch. On GTK the real widget computes it in C; on
 * React Native `@gjsify/adwaita-core`'s `EntryRowState` — the same state machine
 * `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` compose — computes it in
 * TypeScript. So the suites assert the same rows of the same table on both sides.
 */
export function AdwEntryRow(_props: AdwEntryRowProps): ReactElement | null {
    return refuseBaseModule('AdwEntryRow');
}
