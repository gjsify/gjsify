// `AdwPasswordEntryRow` — the base module. See `../refuse.ts` for who reaches this and why
// it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwPasswordEntryRowProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * An entry row whose contents are masked, with a button that peeks at them.
 *
 * THE TWO IMPLEMENTATIONS SHARE `update_empty` AND THE PEEK PAIR. On GTK the real
 * `Adw.PasswordEntryRow` runs both in C; on React Native `@gjsify/adwaita-core`'s
 * `EntryRowState` and the `PasswordEntryRowState` that COMPOSES it — mirroring the C, which
 * subclasses but reaches its parent through a private hook — run them in TypeScript. The
 * mask is the assertion both suites share: masked on mount, clear after one press of the
 * peek button, and the peek button's accessible name flipping with it.
 */
export function AdwPasswordEntryRow(_props: AdwPasswordEntryRowProps): ReactElement | null {
    return refuseBaseModule('AdwPasswordEntryRow');
}
