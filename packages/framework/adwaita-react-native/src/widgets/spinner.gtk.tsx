/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwSpinner` on GTK — the real `Adw.Spinner`. (On the pragma, see `bin.gtk.tsx`.)
//
// THE PROPERTIES ARE `GtkWidget`'s AND THAT IS THE WHOLE WIDGET: `Adw.Spinner` declares
// none of its own, so `width-request`/`height-request` are what a caller has. Measured
// on libadwaita 1.9.3 — a fresh spinner measures `[16, 16, -1, -1]` horizontally, one
// with `width-request` 200 measures `[200, 200, -1, -1]`, and `-1` is GTK's own "no
// request", which is why `resolveSpinnerSize(-1)` answering 16 on the other half is an
// agreement rather than a coincidence.
//
// `spinnerGeometry` IS NOT USED HERE. The ring is painted by `AdwSpinnerPaintable` in C
// and is not a node in the tree at all — so the GTK half can be asked about the BOX and
// about whether it rasterises, and the ring diameter is asserted where it IS a node,
// which is the React Native half. That asymmetry is named in the README.

import type { ReactElement } from 'react';

import type { AdwSpinnerProps } from '../props.js';

/** {@link import('./spinner.js').AdwSpinner} on GTK. */
export function AdwSpinner({ widthRequest, heightRequest }: AdwSpinnerProps): ReactElement | null {
    return <adw-spinner width-request={widthRequest} height-request={heightRequest} />;
}
