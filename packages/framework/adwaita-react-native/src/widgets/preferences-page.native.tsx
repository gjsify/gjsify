/** @jsxImportSource react */
// `AdwPreferencesPage` on React Native — the page's contract without the page's scroller.
// (On the pragma, see `bin.native.tsx`.)
//
// THE PAGE IS NOT A `ScrollView`, AND THAT IS A RULE OF THE TEST DOUBLE RATHER THAN A SHRUG.
// `testing/react-native.ts` may only double a React Native component that IS a host element
// with its props forwarded; `ScrollView` is a composite that renders `RCTScrollView` AROUND a
// second content `View` and moves `contentContainerStyle` onto it. A double of it would be a
// nesting and a prop placement real React Native never emits, and every assertion written
// against it would be about the double — the measured reason `spinner.native.tsx` refuses
// `ActivityIndicator`. So this half emits the column, a consumer wraps it in a real
// `ScrollView`, and the README carries the divergence.
//
// FOUR OF THE FIVE PROPERTIES ARE CARRIED AND NOT DRAWN — `title`, `iconName`, `name`,
// `useUnderline` — which is not this half being thin: `Adw.PreferencesPage` does not draw
// them either. They are what `adw_preferences_dialog_add` binds onto the view-stack page and
// what `create_search_row_subtitle` reads back. `preferences.native.spec.tsx` pins that the
// tree contains no node carrying them, so the day one appears is a decision and not a drift.
//
// `description` IS DRAWN, and it follows `string_is_not_empty` like every other Adwaita
// label — the node stays in the tree with `display: 'none'`, which is the only shape in which
// a suite can say the description is hidden rather than absent.

import { type ReactElement } from 'react';
import { Text, View, type ViewStyle } from 'react-native';

import { stringIsNotEmpty } from '@gjsify/adwaita-core';

import type { AdwPreferencesPageProps } from '../props.js';
import { ADW_ROW_HIDDEN_STYLE } from '../row-shell.native.js';

/** The page is a column, and it takes the width it is given. */
const PAGE_STYLE: ViewStyle = { flexDirection: 'column', alignSelf: 'stretch' };

/** `description-centered`, as the one style this half derives from a property. */
const CENTERED_DESCRIPTION = { textAlign: 'center' } as const;

/** {@link import('./preferences-page.js').AdwPreferencesPage} on React Native. */
export function AdwPreferencesPage({
    children,
    title: _title,
    iconName: _iconName,
    name: _name,
    description,
    descriptionCentered,
    useUnderline: _useUnderline,
}: AdwPreferencesPageProps): ReactElement | null {
    const text = description ?? '';
    const visible = stringIsNotEmpty(text);
    return (
        <View style={PAGE_STYLE}>
            <Text
                style={
                    visible ? (descriptionCentered === true ? CENTERED_DESCRIPTION : undefined) : ADW_ROW_HIDDEN_STYLE
                }
            >
                {text}
            </Text>
            {children}
        </View>
    );
}
