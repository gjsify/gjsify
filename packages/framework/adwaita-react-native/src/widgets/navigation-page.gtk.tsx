/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwNavigationPage` on GTK — the real `Adw.NavigationPage`. (The pragma above is
// required of every platform module; the reason is in `bin.gtk.tsx`.)
//
// THE PAGE IS A WIDGET HERE AND METADATA EVERYWHERE ELSE, which is the whole reason it
// is a component rather than a prop object. `adw_navigation_view_add` and
// `adw_navigation_split_view_set_sidebar` both take an `AdwNavigationPage` and reject a
// bare `GtkWidget`, so on this half the three properties have to live on a real widget
// in the tree. On React Native they are read off the element's props instead, because
// there is no object to put them on.
//
// AN OMITTED PROP IS LEFT TO LIBADWAITA, not defaulted here: `title` is `''` and
// `can-pop` is TRUE in `adw_navigation_page_init`, and passing those values back in
// would make this file a second authority for a default the installed libadwaita
// already owns. Same rule `clamp.gtk.tsx` states for `maximum-size`.

import type { ReactElement } from 'react';

import type { AdwNavigationPageProps } from '../props.js';

/** {@link import('./navigation-page.js').AdwNavigationPage} on GTK. */
export function AdwNavigationPage({ children, title, tag, canPop }: AdwNavigationPageProps): ReactElement | null {
    return (
        <adw-navigation-page title={title} tag={tag} can-pop={canPop}>
            {children}
        </adw-navigation-page>
    );
}
