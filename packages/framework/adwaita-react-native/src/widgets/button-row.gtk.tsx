/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwButtonRow` on GTK — the real `Adw.ButtonRow`. (On the pragma, see `bin.gtk.tsx`.)
//
// NO `activatable` IS WRITTEN, and that is the widget rather than an omission:
// `adw-button-row.ui` sets `activatable=True` on the template and installs no property to
// change it. `@gjsify/adwaita-core`'s `BUTTON_ROW_ACTIVATABLE` is that fact as data, and
// the React Native half reads it because a `View` has no such default to inherit; here
// the class supplies it, so writing it would be a second authority for one value.
//
// AND NO CHILDREN. `Adw.ButtonRow` derives from `AdwPreferencesRow` and declares no
// child API at all — no `add_prefix`, no `add_suffix`, no `set_child` — which is why
// `AdwButtonRowProps` does not extend `AdwWidgetProps`: a child written here is a type
// error rather than a `@gjsify/gtk-host` `uncurated-placement` refusal at first render.

import type { ReactElement } from 'react';

import type { AdwButtonRowProps } from '../props.js';

/** {@link import('./button-row.js').AdwButtonRow} on GTK. */
export function AdwButtonRow({ title, onActivated }: AdwButtonRowProps): ReactElement | null {
    return <adw-button-row title={title} onActivated={onActivated} />;
}
