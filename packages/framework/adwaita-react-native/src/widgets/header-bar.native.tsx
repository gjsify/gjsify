/** @jsxImportSource react */
// `AdwHeaderBar` on React Native — three slots in a row. (On the pragma, see
// `bin.native.tsx`.)
//
// THE SHAPE IS `@gjsify/adwaita-nativescript`'s, not a new one. That port renders a
// `GridLayout` with columns `auto, *, auto` — the start slot hugs, the centre takes the
// rest and is centred in it, the end slot hugs and is pinned right — and defaults the
// centre to an `AdwWindowTitle` so `title`/`subtitle` work out of the box. The React
// Native spelling of `auto, *, auto` is a row with `flex: 1` on the middle child, and
// that is the only thing that changes.
//
// THE CENTRE IS A REAL `AdwWindowTitle`, this package's own, so the visibility rule and
// the empty-title collapse are made in ONE place instead of being written out again here
// — the same delegation `@gjsify/adwaita-web` records as `CORE-VIA` on its own bar.
//
// UNLIKE THE GTK HALF, an unauthored title leaves a blank centre rather than the window's
// title: `update_title`'s chain is an ancestry walk (navigation page → dialog → window →
// application name) and a phone has none of those to walk. Named in the README, and the
// GTK half carries the other side of it.
//
// NO WINDOW CONTROLS. `show-start-title-buttons` / `show-end-title-buttons` /
// `decoration-layout` are not on this surface at all, because a phone has no window
// controls to show — an inert prop would be worse than an absent one, and neither of the
// other two renderers has them either.

import type { ReactElement } from 'react';
import { View, type ViewStyle } from 'react-native';

import type { AdwHeaderBarProps } from '../props.js';
import { AdwWindowTitle } from './window-title.native.js';

/** The bar itself: one row, its three slots side by side. */
const BAR: ViewStyle = { flexDirection: 'row', alignItems: 'center' };

/** `auto` — the slot hugs its contents and packs them along the bar. */
const HUG: ViewStyle = { flexDirection: 'row', alignItems: 'center' };

/** `*` — the centre takes what is left, and centres what it holds inside it. */
const CENTRE: ViewStyle = { flex: 1, alignItems: 'center', justifyContent: 'center' };

/** {@link import('./header-bar.js').AdwHeaderBar} on React Native. */
export function AdwHeaderBar({ titleWidget, title, subtitle, start, end }: AdwHeaderBarProps): ReactElement | null {
    // The same either/or the GTK half writes, and the same one
    // `adw_header_bar_set_title_widget` has: a custom centre replaces the derived title
    // rather than stacking with it.
    const centre = titleWidget !== undefined ? titleWidget : <AdwWindowTitle title={title} subtitle={subtitle} />;

    return (
        <View style={BAR}>
            <View style={HUG}>{start}</View>
            <View style={CENTRE}>{centre}</View>
            <View style={HUG}>{end}</View>
        </View>
    );
}
