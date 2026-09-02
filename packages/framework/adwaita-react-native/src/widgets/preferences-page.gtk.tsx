/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwPreferencesPage` on GTK — the real `Adw.PreferencesPage`. (On the pragma, see
// `bin.gtk.tsx`.)
//
// NOTHING IS DEFAULTED HERE, for the reason `banner.gtk.tsx` gives at length: an omitted
// property has to leave the real widget on the value the INSTALLED libadwaita gives it, so a
// drift between libadwaita and this package is visible rather than silent.
//
// `name` IS THE PAGE'S OWN PROPERTY AND NOT `GtkWidget:name`, which matters because the two
// collide. `AdwPreferencesPageProps` in gtk-host's generated table is declared over
// `Omit<GtkWidgetProps, 'name'>` precisely so the page's `name` wins — the CSS node name is
// not reachable from this surface, and that is the right way round: `adw_preferences_dialog_add`
// binds this one onto the view-stack child.

import type { ReactElement } from 'react';

import type { AdwPreferencesPageProps } from '../props.js';

/** {@link import('./preferences-page.js').AdwPreferencesPage} on GTK. */
export function AdwPreferencesPage({
    children,
    title,
    iconName,
    name,
    description,
    descriptionCentered,
    useUnderline,
}: AdwPreferencesPageProps): ReactElement | null {
    return (
        <adw-preferences-page
            title={title}
            icon-name={iconName}
            name={name}
            description={description}
            description-centered={descriptionCentered}
            use-underline={useUnderline}
        >
            {children}
        </adw-preferences-page>
    );
}
