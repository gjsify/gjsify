/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwClamp` on GTK — the real `Adw.Clamp`. Libadwaita does the arithmetic.
//
// `clampAllocate` IS NOT USED HERE, and that is the design rather than an omission.
// `adwaita-core`'s port of `adw_clamp_layout_allocate` is for renderers that have no
// libadwaita; on GTK the C original is right there, and computing the same number twice
// would give the widget two authorities for its own layout. The core's value on this
// path is as the oracle the React Native half is measured against.
//
// WHAT THE CORE DOES OWN ON BOTH PATHS IS THE INPUT RULE. `normalizeClampSize` runs
// here for the same reason it runs in `clamp.native.tsx`: an authored value GObject
// cannot store has to mean the same thing on both halves. Handing the raw prop to the
// widget did not do that — measured through this component against libadwaita 1.9.3 in
// a 1000-point window:
//
//     authored     GTK on mount   GTK on update   React Native
//     400.7        400            400             400
//     NaN          0  (!)         unchanged       600
//     -5           600            unchanged       0
//
// Three rows of disagreement, and two of the GTK cells came with a
// `GLib-GObject-CRITICAL` that `installDiagnosticsGate` fails on. The asymmetry is
// GObject's own: `new Adw.Clamp({'maximum-size': NaN})` converts NaN to 0 and STORES
// it, while `set_property('maximum-size', -5)` fails `g_param_value_validate` and
// leaves the property alone — so one authored value meant two different things on mount
// and on update, inside one half. Normalising first removes all three rows: the widget
// only ever sees a value inside `g_param_spec_int (…, 0, G_MAXINT, …)`, so there is
// nothing left for GObject to refuse and nothing left for the halves to disagree on.
//
// The pragma above is required of every platform module; the reason is in
// `bin.gtk.tsx`.

import type { ReactElement } from 'react';

import { ADW_CLAMP_DEFAULTS, normalizeClampSize } from '@gjsify/adwaita-core';

import type { AdwClampProps } from '../props.js';

/**
 * An authored size as GObject would have to store it, or `undefined` for "not authored".
 *
 * The omitted case is deliberately NOT routed through the normaliser, and that is the
 * one thing this file may not pin: an omitted property has to leave the real
 * `Adw.Clamp` on its own default, so the common case reads the INSTALLED libadwaita's
 * value rather than `adwaita-core`'s transcription of it. A drift between the two is
 * then visible instead of silent — `clamp.gtk.spec.tsx` reads 575 at x=62 off the live
 * GTK tree for the omitted case and `clamp.native.spec.tsx` asserts that pair off
 * `ADW_CLAMP_DEFAULTS`, so the pair fails. `ADW_CLAMP_DEFAULTS` here is reached only
 * for a value the caller DID author and GObject would refuse, which is precisely where
 * the two halves have to answer alike.
 */
const authoredSize = (value: number | undefined, fallback: number): number | undefined =>
    value === undefined ? undefined : normalizeClampSize(value, fallback);

/**
 * {@link import('./clamp.js').AdwClamp} on GTK.
 *
 * `maximumSize` and `tighteningThreshold` reach the widget as UNDEFINED when the caller
 * omits them, so `Adw.Clamp` keeps its own property defaults (600 / 400).
 */
export function AdwClamp({ children, maximumSize, tighteningThreshold }: AdwClampProps): ReactElement | null {
    return (
        <adw-clamp
            maximum-size={authoredSize(maximumSize, ADW_CLAMP_DEFAULTS.maximumSize)}
            tightening-threshold={authoredSize(tighteningThreshold, ADW_CLAMP_DEFAULTS.tighteningThreshold)}
        >
            {children}
        </adw-clamp>
    );
}
