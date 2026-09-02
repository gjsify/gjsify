/** @jsxImportSource react */
// `AdwNavigationPage` on React Native — a `View` holding the page body. (On the pragma,
// see `bin.native.tsx`.)
//
// IT DRAWS NONE OF ITS THREE PROPERTIES, AND THAT IS THE WIDGET AND NOT A GAP.
// `Adw.NavigationPage` is an `AdwBin` carrying a title, a tag and `can-pop`; the title
// reaches a screen only because the VIEW puts it in a header bar, and the tag and
// `can-pop` are never drawn at all. So on this half the three are read off the element's
// props by whatever holds the page — `navigation-view.native.tsx` hands them straight to
// `NavigationViewState` — and the page itself is the bin.
//
// `flex: 1` RATHER THAN NOTHING: a navigation page is the whole screen inside its view,
// which is what `Adw.NavigationView` allocates it and what `@gjsify/adwaita-web`'s
// `.adw-navigation-page` and NativeScript's full-span grid cell both give it. A
// default-sized `View` would collapse to its content and leave the rest of the view
// blank — a divergence nobody would see until a page had a background.

import type { ReactElement } from 'react';
import { View } from 'react-native';

import type { AdwNavigationPageProps } from '../props.js';

/** {@link import('./navigation-page.js').AdwNavigationPage} on React Native. */
export function AdwNavigationPage({ children }: AdwNavigationPageProps): ReactElement | null {
    return <View style={{ flex: 1 }}>{children}</View>;
}
