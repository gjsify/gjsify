/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwBin` on GTK — the real `Adw.Bin`, adopted through `@gjsify/gtk-host`.
//
// THE PRAGMA IS LOAD-BEARING AND IS CHECKED. `jsxImportSource` decides which element
// list `<adw-bin>` is looked up in. Pointed at `react` it would come from
// `@types/react`, where all 208 HTML/SVG/MathML tags type-check and none of them
// render on a GTK host — so `<div>` would be a silent blank instead of a TS2339.
// The tsconfig sets the same value, and the pragma is still written here because
// `scripts/check-adwaita-rn-platform-split.mjs` requires one per platform module:
// the sibling `.native.tsx` needs the OPPOSITE value, so neither file may inherit
// the project default and be right by accident.

import type { ReactElement } from 'react';

import type { AdwBinProps } from '../props.js';

/** {@link import('./bin.js').AdwBin} on GTK. */
export function AdwBin({ children }: AdwBinProps): ReactElement | null {
    return <adw-bin>{children}</adw-bin>;
}
