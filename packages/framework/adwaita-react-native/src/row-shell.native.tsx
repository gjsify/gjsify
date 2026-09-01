/** @jsxImportSource react */
// The React Native row SKELETON the boxed-list rows share — structure only.
//
// NOT IN `widgets/`, deliberately: `check-adwaita-rn-platform-split.mjs` derives the
// package's widget set from the file names in that directory, so a `row-shell.native.tsx`
// beside the widgets would be read as a widget with two thirds of itself missing.
//
// WHAT IS HERE IS STRUCTURE, AND WHAT IS NOT IS THEME. `flexDirection: 'row'` is not a
// styling decision — without it the title column and the trailing control stack
// vertically and the widget is not a row at all — so it belongs to the widget. Padding,
// type scale, dim-label colour and the row separator are theme, `@gjsify/adwaita-core`'s
// `/tokens` subpath states outright that projecting its CSS custom properties onto a
// style scale is a mapping decision of its own, and this slice does not make it. The
// README says so where a reader will look for it.
//
// BOTH LABELS ARE ALWAYS IN THE TREE and the hidden one carries `display: 'none'`, which
// is what the sibling renderers do — `@gjsify/adwaita-web` sets `hidden`,
// `@gjsify/adwaita-nativescript` sets `visibility: 'collapse'` — and it is the only shape
// in which a suite can tell WHICH label is hidden. Rendering `null` for an invisible
// label leaves one `Text` in the tree and no way to say whether it is the title or the
// subtitle, and `title=""` with a subtitle is a real state.

import type { ReactElement } from 'react';
import { Text, View, type ViewStyle } from 'react-native';

import { deriveRowLabels, type AdwRowLabelInput } from '@gjsify/adwaita-core';

/** A boxed-list row: the label column, then whatever trails it. */
export const ADW_ROW_STYLE: ViewStyle = { flexDirection: 'row', alignItems: 'center' };

/** The title/subtitle column — it takes the width the trailing control does not. */
export const ADW_ROW_TEXT_COLUMN_STYLE: ViewStyle = { flexDirection: 'column', flexGrow: 1, flexShrink: 1 };

/**
 * A part that is present and not drawn.
 *
 * `string_is_not_empty` said `false` for a label, or the apply latch is down for a
 * button: the node stays in the tree and stops drawing, which is what the sibling
 * renderers do and what lets a suite say WHICH part is hidden.
 */
export const ADW_ROW_HIDDEN_STYLE: ViewStyle = { display: 'none' };

/**
 * The two labels of a boxed-list row, with libadwaita's own visibility rule.
 *
 * The rule is `@gjsify/adwaita-core`'s `deriveRowLabels`, not a local `title !== ''`:
 * it is the closure `adw-action-row.ui` binds to BOTH labels — the title's too, which is
 * the half a hand-written port drops — and it is the same call `@gjsify/adwaita-web`'s
 * `<adw-switch-row>` and `@gjsify/adwaita-nativescript`'s `rowLabelVisuals` make.
 */
export function AdwRowLabels({ title, subtitle }: AdwRowLabelInput): ReactElement {
    const labels = deriveRowLabels({ title, subtitle });
    return (
        <View style={ADW_ROW_TEXT_COLUMN_STYLE}>
            <Text style={labels.titleVisible ? undefined : ADW_ROW_HIDDEN_STYLE}>{labels.title}</Text>
            <Text style={labels.subtitleVisible ? undefined : ADW_ROW_HIDDEN_STYLE}>{labels.subtitle}</Text>
        </View>
    );
}
