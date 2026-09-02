/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwPreferencesGroup` on GTK — the real `Adw.PreferencesGroup`. (On the pragma, see
// `bin.gtk.tsx`.)
//
// `derivePreferencesGroupHeader` IS NOT USED HERE, and that is the design rather than an
// omission — the same call `clamp.gtk.tsx` makes about `clampAllocate`. The core's port of
// the five visibility rules is for a renderer that has no libadwaita; on GTK the C originals
// run inside the widget, and deriving the same five answers a second time would give the
// group two authorities for whether its own header is showing. The core's value on this path
// is as the oracle `preferences.native.spec.tsx` is measured against.
//
// THE CHILDREN ARE ROWS, through the curated `ordered` policy in
// `packages/framework/gtk-host/src/descriptors/adw.ts` — `add`/`remove`, and `remove-all`
// to reorder, because `Adw.PreferencesGroup.insert` does not exist on libadwaita 1.x. The
// page above it is `indexed` and DOES have `insert`; that asymmetry is measured and recorded
// there, and it is why this widget needed no descriptor of its own to land.

import type { ReactElement } from 'react';

import type { AdwPreferencesGroupProps } from '../props.js';

/** {@link import('./preferences-group.js').AdwPreferencesGroup} on GTK. */
export function AdwPreferencesGroup({ children, title, description }: AdwPreferencesGroupProps): ReactElement | null {
    return (
        <adw-preferences-group title={title} description={description}>
            {children}
        </adw-preferences-group>
    );
}
