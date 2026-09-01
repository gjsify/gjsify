// `AdwHeaderBar` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwHeaderBarProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * The start / centre / end bar at the top of a window.
 *
 * THE PHONE QUESTION IS THE CENTRE, and this package answers it the way
 * `@gjsify/adwaita-nativescript` already did rather than inventing a third answer:
 * `Adw.HeaderBar` has NO `title` property — its derived centre is a plain
 * `gtk_label_new (NULL)` over a title RESOLVED from the navigation page, the dialog, the
 * window and then the application name (`update_title`, adw-header-bar.c:475) — and both
 * existing renderers instead expose `title`/`subtitle` on the bar and put an
 * `AdwWindowTitle` in the centre. That is a DIVERGENCE, recorded as
 * `HeaderBarRenderState.derivedSubtitle` in `@gjsify/adwaita-core`, and it is kept here
 * because a declarative surface has no widget handoff to offer instead.
 *
 * WHAT THE TWO HALVES DO NOT SHARE is what happens when nothing is authored. On GTK the
 * chain is REAL and free: authoring neither `title` nor `subtitle` installs no title
 * widget at all, so libadwaita resolves the window's own title into its own label, which
 * `header-bar.gtk.spec.tsx` reads back. React Native has no such ancestry to resolve
 * from, so an unauthored title there is blank. Named in the README.
 *
 * `HeaderBarState` IS DELIBERATELY NOT USED. It is an imperative model over an
 * identity-keyed child list — `packStart`, `packEnd`, `remove` — and a props object is
 * already the whole state, recomputed on every render. Of the three rules it holds, two
 * do not arise on this surface: `pack_end`'s prepend is invisible where the slot is
 * written in draw order, and the "taking the centre back rebuilds the derived title"
 * transition is just the next render. The third — the title-widget either/or — is one
 * expression, and both halves below write the same one.
 */
export function AdwHeaderBar(_props: AdwHeaderBarProps): ReactElement | null {
    return refuseBaseModule('AdwHeaderBar');
}
