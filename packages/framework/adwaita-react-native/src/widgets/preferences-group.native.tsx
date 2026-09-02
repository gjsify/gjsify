/** @jsxImportSource react */
// `AdwPreferencesGroup` on React Native — libadwaita's five visibility rules, run in
// TypeScript. (On the pragma, see `bin.native.tsx`.)
//
// `@gjsify/adwaita-core`'s `derivePreferencesGroupHeader` IS `update_title_visibility`,
// `update_description_visibility`, `update_header_visibility`, `is_single_line` and
// `update_listbox_visibility` — five C functions with one answer each, derived together
// because they read the same four inputs. So this file renders the answers libadwaita would
// have computed rather than a `title && <Text>` per label, which agrees with
// `Adw.PreferencesGroup` on the two obvious rows and nowhere else:
//
//     authored                       header shown?   single-line?   card shown?
//     title, no description, 1 row    yes             yes            yes
//     no title, no description, 1 row no              no             yes
//     title + description, 1 row      yes             NO             yes
//     title, no description, 0 rows   yes             yes            NO
//
// The third and fourth rows are the ones a hand-written port gets wrong: the card hides
// itself at zero rows while its HEADER stays, which is how an empty group still announces
// what it is.
//
// `singleLine` IS DERIVED AND NOT DRAWN, the same shape as `AdwStatusPageProps`' `iconName`.
// It is a STYLESHEET number — `min-height: 34px` for a single-line header, `margin-bottom:
// 6px` for a multi-line one — and this package's React Native half draws no theme
// (`row-shell.native.tsx` says where that line is). It is computed here rather than dropped
// because it comes out of the same call as the four that ARE drawn, and because the day this
// package gains a token scale it is already correct. The README names it as carried and not
// painted.
//
// `rowCount` IS `Children.toArray(children).length` AND THAT IS THE RAW COUNT ON PURPOSE.
// `update_listbox_visibility` reads `gtk_widget_observe_children (listbox)`, NOT the
// title-filtered model `get_rows` builds, so a row with an empty title still keeps the card
// painted. `Children.toArray` and not `Children.count`: the latter counts a `null` branch as
// a child, so `{show && <Row/>}` with `show` false would keep an empty card painted.
//
// `useMarkup: false` — BOTH SIBLING RENDERERS PASS IT AND SO DOES THIS ONE. The core's
// default is `true`, because `adw-preferences-group.ui` sets `use-markup` on both labels and
// the visibility test then reads the DISPLAYED text, so `<b></b>` is an empty label on GTK.
// This half has no Pango and paints the string verbatim, which is exactly the case the core
// documents `false` for. The consequence is one row of divergence — a title that is pure
// markup is hidden on GTK and shown here — and the README carries it.

import { Children, type ReactElement } from 'react';
import { Text, View, type ViewStyle } from 'react-native';

import { derivePreferencesGroupHeader } from '@gjsify/adwaita-core';

import type { AdwPreferencesGroupProps } from '../props.js';
import { ADW_ROW_HIDDEN_STYLE } from '../row-shell.native.js';

/** The group is a column: header, then card. */
const GROUP_STYLE: ViewStyle = { flexDirection: 'column', alignSelf: 'stretch' };

/** The header holds the two labels — a column, because a description sits UNDER the title. */
const HEADER_STYLE: ViewStyle = { flexDirection: 'column' };

/** The card. `.boxed-list` on the siblings; here, structure only. */
const LISTBOX_STYLE: ViewStyle = { flexDirection: 'column', alignSelf: 'stretch' };

/** {@link import('./preferences-group.js').AdwPreferencesGroup} on React Native. */
export function AdwPreferencesGroup({ children, title, description }: AdwPreferencesGroupProps): ReactElement | null {
    const rows = Children.toArray(children);
    const header = derivePreferencesGroupHeader({
        title,
        description,
        // No `header-suffix` on this surface — `props.ts` carries why, and passing the
        // literal keeps the third input of `headerVisible` visible at the call site rather
        // than hidden in a default.
        hasHeaderSuffix: false,
        rowCount: rows.length,
        useMarkup: false,
    });

    return (
        <View style={GROUP_STYLE}>
            <View style={header.headerVisible ? HEADER_STYLE : ADW_ROW_HIDDEN_STYLE}>
                <Text style={header.titleVisible ? undefined : ADW_ROW_HIDDEN_STYLE}>{title ?? ''}</Text>
                <Text style={header.descriptionVisible ? undefined : ADW_ROW_HIDDEN_STYLE}>{description ?? ''}</Text>
            </View>
            <View style={header.listboxVisible ? LISTBOX_STYLE : ADW_ROW_HIDDEN_STYLE}>{children}</View>
        </View>
    );
}
