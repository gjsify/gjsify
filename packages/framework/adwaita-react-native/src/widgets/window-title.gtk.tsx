/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwWindowTitle` on GTK — the real `Adw.WindowTitle`. (The pragma above is required of
// every platform module; the reason is in `bin.gtk.tsx`.)
//
// NEITHER PROPERTY IS NORMALISED HERE, and unlike `clamp.gtk.tsx` that is not a decision
// about ranges — both are `g_param_spec_string` with no range to fall outside of, and the
// only value GObject would refuse is one this surface cannot express. What the two halves
// have to agree on is the EMPTY case, and they do: `adw_window_title_set_title (…, NULL)`
// and `title=""` both leave a label that exists and is not visible, which is exactly what
// `deriveRowLabels` reports on the other half.
//
// An OMITTED property is passed through as `undefined` and never written, so the widget
// keeps libadwaita's own default — the same rule `clamp.gtk.tsx` states at length.

import type { ReactElement } from 'react';

import type { AdwWindowTitleProps } from '../props.js';

/** {@link import('./window-title.js').AdwWindowTitle} on GTK. */
export function AdwWindowTitle({ title, subtitle }: AdwWindowTitleProps): ReactElement | null {
    return <adw-window-title title={title} subtitle={subtitle} />;
}
