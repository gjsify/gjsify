// `AdwPreferencesPage` — the base module. See `../refuse.ts` for who reaches this and why
// it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwPreferencesPageProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A scrolling page of preference groups.
 *
 * THE TWO IMPLEMENTATIONS SHARE THE PAGE'S CONTRACT AND NOT ITS SCROLLER. On GTK the real
 * `Adw.PreferencesPage` is an `AdwBin` around a `GtkScrolledWindow`; on React Native the
 * page is a plain column, because `ScrollView` is a COMPOSITE that moves props into a
 * content container and `testing/react-native.ts` may only double a host element with its
 * props forwarded. The divergence is one-directional, named in the README, and does not
 * touch what the page IS — four identity properties a view switcher reads and one
 * description it draws.
 */
export function AdwPreferencesPage(_props: AdwPreferencesPageProps): ReactElement | null {
    return refuseBaseModule('AdwPreferencesPage');
}
