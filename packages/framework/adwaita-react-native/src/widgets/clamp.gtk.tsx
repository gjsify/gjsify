/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwClamp` on GTK — the real `Adw.Clamp`. Libadwaita does the arithmetic.
//
// NOTHING FROM `@gjsify/adwaita-core` IS USED HERE, and that is the design rather
// than an omission. `adwaita-core`'s `clampAllocate` is a PORT of
// `adw_clamp_layout_allocate` for renderers that have no libadwaita; on GTK the C
// original is right there, and computing the same number twice would give the widget
// two authorities for its own layout. The core's value on this path is as the
// oracle the React Native half is measured against, not as a second implementation.
//
// The pragma above is required of every platform module; the reason is in
// `bin.gtk.tsx`.

import type { ReactElement } from 'react';

import type { AdwClampProps } from '../props.js';

/**
 * {@link import('./clamp.js').AdwClamp} on GTK.
 *
 * `maximumSize` and `tighteningThreshold` are passed through UNDEFINED when the
 * caller omits them, so `Adw.Clamp` keeps its own property defaults (600 / 400).
 * Substituting `ADW_CLAMP_DEFAULTS` here would work today and pin this file to the
 * values a future libadwaita is free to change.
 */
export function AdwClamp({ children, maximumSize, tighteningThreshold }: AdwClampProps): ReactElement | null {
    return (
        <adw-clamp maximum-size={maximumSize} tightening-threshold={tighteningThreshold}>
            {children}
        </adw-clamp>
    );
}
