/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwActionRow` on GTK — the real `Adw.ActionRow`, adopted through `@gjsify/gtk-host`.
// (The pragma above is required of every platform module; the reason is in `bin.gtk.tsx`.)
//
// `deriveRowLabels` IS NOT USED HERE, for the reason `clamp.gtk.tsx` does not call
// `clampAllocate`: the C original is right there, bound in `adw-action-row.ui` as
// `string_is_not_empty`, and computing the same visibility twice would give one label two
// authorities. The core's value on this path is as the oracle the React Native half is
// measured against.
//
// CHILDREN LAND IN THE SUFFIX, and that is `@gjsify/gtk-host`'s curated descriptor for
// this GType rather than a choice made here: `slots: { prefix: 'add_prefix', suffix:
// 'add_suffix' }` with `defaultSlot: 'suffix'`. Writing `slot="prefix"` on a child reaches
// the other one on THIS half only, so `props.ts` does not offer it as a surface prop.

import type { ReactElement } from 'react';

import type { AdwActionRowProps } from '../props.js';

/** {@link import('./action-row.js').AdwActionRow} on GTK. */
export function AdwActionRow({
    title,
    subtitle,
    activatable,
    onActivated,
    children,
}: AdwActionRowProps): ReactElement | null {
    return (
        <adw-action-row title={title} subtitle={subtitle} activatable={activatable} onActivated={onActivated}>
            {children}
        </adw-action-row>
    );
}
