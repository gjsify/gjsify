/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwStatusPage` on GTK — the real `Adw.StatusPage`. (The pragma above is required of
// every platform module; the reason is in `bin.gtk.tsx`.)
//
// THE VISIBILITY RULE IS NOT RUN HERE, and that is the point of the widget being real:
// `has_image` (adw-status-page.c:88) and the two `string_is_not_empty` bindings are
// evaluated in C against the properties written below, so this half asserts them by
// READING the live labels back rather than by deriving them a second time.
// `status-page.native.spec.tsx` asserts the same three decisions on the other half,
// where `@gjsify/adwaita-core` has to make them.
//
// `child` IS `children`: `Adw.StatusPage:child` is a one-child property and gtk-host's
// `single` policy fills it with `set_child`, so a SECOND child evicts the first with no
// throw and no GLib message — the divergence the README names for every one-child slot in
// this package.

import type { ReactElement } from 'react';

import type { AdwStatusPageProps } from '../props.js';

/** {@link import('./status-page.js').AdwStatusPage} on GTK. */
export function AdwStatusPage({ children, iconName, title, description }: AdwStatusPageProps): ReactElement | null {
    return (
        <adw-status-page icon-name={iconName} title={title} description={description}>
            {children}
        </adw-status-page>
    );
}
