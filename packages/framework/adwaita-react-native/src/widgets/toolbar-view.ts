// `AdwToolbarView` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwToolbarViewProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A content area framed by top and/or bottom bars.
 *
 * WHAT THE TWO HALVES SHARE IS THE ARRANGEMENT, NOT THE ARITHMETIC, and that is a
 * measured statement rather than a shortcut. `adw_toolbar_view_size_allocate` is two
 * chained GLib CLAMPs over the bars' MINIMUM and NATURAL heights — ported in
 * `@gjsify/adwaita-core` as `toolbarViewAllocate` and held to vectors — and neither this
 * half nor `@gjsify/adwaita-nativescript`'s can run it: both get an ALREADY-LAID-OUT size
 * from their engine and never a child's intrinsic minimum, so feeding the measurement in
 * as both `min` and `nat` would turn each CLAMP into the identity and dress a
 * pass-through up as libadwaita's arithmetic. The consequence is real and one-directional
 * — a STRETCHY bar keeps its natural height where libadwaita would shrink it toward its
 * minimum to protect the content — and the README names it.
 *
 * The other half of the widget, `toolbarViewClasses`, is four STYLE CLASSES (`raised`,
 * `border`, `undershoot-top`, `undershoot-bottom`), and React Native has no class system
 * to stamp them into. So `topBarStyle` and `bottomBarStyle` reach the real widget on GTK
 * and draw nothing on a phone; that too is named in the README and pinned by a test on
 * each side.
 */
export function AdwToolbarView(_props: AdwToolbarViewProps): ReactElement | null {
    return refuseBaseModule('AdwToolbarView');
}
