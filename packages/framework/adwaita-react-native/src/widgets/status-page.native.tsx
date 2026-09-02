/** @jsxImportSource react */
// `AdwStatusPage` on React Native — the centred stack, minus the icon. (On the pragma,
// see `bin.native.tsx`.)
//
// NO ICON NODE AT ALL, and it is a divergence rather than an oversight. `icon-name` names
// an entry in an ICON THEME, and React Native has none: there is no `Image` source a GNOME
// symbolic name resolves to on a phone, and no renderer for the SVG that
// `@gjsify/adwaita-nativescript` substituted (it takes an SVG STRING for the same reason,
// which is a different property under the same name). Drawing the name as text would put
// the literal `folder-symbolic` on screen. So the prop is carried — both halves declare
// the same surface, and a GTK consumer's props stay portable — and this half draws
// nothing for it. `status-page.native.spec.tsx` asserts the ABSENCE, so the day an icon
// appears here it is a decision someone made and not a divergence that drifted shut.
//
// THE TWO LABELS FOLLOW `string_is_not_empty`, from `@gjsify/adwaita-core`, and collapse
// with `display: 'none'` rather than being conditionally rendered — the reasoning is in
// `window-title.native.tsx`, and it is upstream's own shape.
//
// The child is rendered LAST and unconditionally, which is where `adw-status-page.ui`
// puts it (:57-62). No typography and no colour here either; the README names it once for
// the whole group.

import type { ReactElement } from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { deriveRowLabels } from '@gjsify/adwaita-core';

import type { AdwStatusPageProps } from '../props.js';

/** `Adw.StatusPage` centres its content box in both directions. */
const PAGE: ViewStyle = { flex: 1, alignItems: 'center', justifyContent: 'center' };

/** `visible=False` on a label, as React Native spells "not in layout". */
const COLLAPSED: TextStyle = { display: 'none' };

/** {@link import('./status-page.js').AdwStatusPage} on React Native. */
export function AdwStatusPage({ children, title, description }: AdwStatusPageProps): ReactElement | null {
    const labels = deriveRowLabels({ title, subtitle: description });
    return (
        <View style={PAGE}>
            <Text style={labels.titleVisible ? undefined : COLLAPSED}>{labels.title}</Text>
            <Text style={labels.subtitleVisible ? undefined : COLLAPSED}>{labels.subtitle}</Text>
            {children}
        </View>
    );
}
