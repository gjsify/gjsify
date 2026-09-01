/** @jsxImportSource react */
// `AdwWindowTitle` on React Native — two `Text`s and libadwaita's visibility rule. (On
// the pragma, see `bin.native.tsx`.)
//
// THE LABELS STAY IN THE TREE AND COLLAPSE, they are not conditionally rendered. That is
// upstream's own shape — `adw-window-title.ui` builds both labels once and binds each
// one's `visible` to `string_is_not_empty` — and React Native has the exact counterpart
// in `display: 'none'`, which takes a node out of layout while leaving it in the tree. It
// also keeps the tree SHAPE constant across a title going empty and back, so React
// reconciles the same two nodes rather than unmounting one; `@gjsify/adwaita-nativescript`
// carries the same rule as `visibility: 'collapse'` and says why its own port used to add
// and remove nodes instead.
//
// THE PREDICATE IS `deriveRowLabels` FROM THE CORE, not a local `.length === 0`.
// `string_is_not_empty` reads the FIRST BYTE and never trims, so a title of `'   '` is a
// VISIBLE title in libadwaita — a `trim()` here would hide a label GTK draws, and both
// other renderers had written the rule out themselves before it was lifted.
//
// NO TYPOGRAPHY AND NO COLOUR, on purpose and named in the README: bold-and-dim is
// `@gjsify/adwaita-web`'s stylesheet and `@gjsify/adwaita-nativescript`'s theme CSS, and
// this package has no theme layer to read `@gjsify/adwaita-core`'s tokens through. What
// this half carries is layout and visibility; inventing a styling seam is a decision this
// slice does not make.

import type { ReactElement } from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { deriveRowLabels } from '@gjsify/adwaita-core';

import type { AdwWindowTitleProps } from '../props.js';

/** `Adw.WindowTitle` is a vertical box whose children are centred. */
const STACK: ViewStyle = { alignItems: 'center' };

/** `visible=False` on the label, as React Native spells "not in layout". */
const COLLAPSED: TextStyle = { display: 'none' };

/** {@link import('./window-title.js').AdwWindowTitle} on React Native. */
export function AdwWindowTitle({ title, subtitle }: AdwWindowTitleProps): ReactElement | null {
    const labels = deriveRowLabels({ title, subtitle });
    return (
        <View style={STACK}>
            <Text style={labels.titleVisible ? undefined : COLLAPSED}>{labels.title}</Text>
            <Text style={labels.subtitleVisible ? undefined : COLLAPSED}>{labels.subtitle}</Text>
        </View>
    );
}
