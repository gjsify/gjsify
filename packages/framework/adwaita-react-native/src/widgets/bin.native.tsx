/** @jsxImportSource react */
// `AdwBin` on React Native — a `View` with one child.
//
// THE PRAGMA IS NOT DECORATION. Without it this file inherits the project's
// `jsxImportSource`, which is `@gjsify/gtk-host/react` so that the GTK modules get a GTK
// element list. The runtime factories are React's own either way — gtk-host's react
// subpath re-exports `jsx`/`jsxs`/`Fragment` verbatim — but the emitted import specifier
// is not, and `import { jsx } from '@gjsify/gtk-host/react/jsx-runtime'` inside a Metro
// bundle is a GTK dependency on a phone. The reason both halves are checked is in
// `bin.gtk.tsx`.
//
// `Adw.Bin` exists on GTK because a GTK widget needs a concrete class to hold one child;
// React Native's `View` is already that, so this file is thin BY CONSTRUCTION. It is in
// the package because the API surface promises it, and a widget the caller has to
// special-case is a surface with a hole in it.

import type { ReactElement } from 'react';
import { View } from 'react-native';

import type { AdwBinProps } from '../props.js';

/** {@link import('./bin.js').AdwBin} on React Native. */
export function AdwBin({ children }: AdwBinProps): ReactElement | null {
    return <View>{children}</View>;
}
