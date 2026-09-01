/** @jsxImportSource react */
// `AdwButtonContent` on React Native. (On the pragma, see `bin.native.tsx`.)
//
// ALL FOUR DERIVATIONS COME FROM THE CORE, and two of them are places a hand-written
// translation goes wrong. `buttonContentIconExpands` is `gtk_widget_set_hexpand
// (self->icon, !label[0])` — the icon takes the free space exactly when there is NO label,
// which is what centres a label-less icon inside the button; `flexGrow` is Yoga's spelling
// of `hexpand` in a row. `buttonContentLabelVisible` is a FIRST-CHARACTER test rather than
// a trim, so a label of spaces keeps its node.
//
// `canShrink` IS A REAL PORT HERE, WHICH IT IS NOT ON NATIVESCRIPT. `PANGO_ELLIPSIZE_END`
// is `numberOfLines={1}` plus `ellipsizeMode="tail"` on a React Native `Text`, so the one
// property `@gjsify/adwaita-nativescript` has to hold and report without honouring is
// actually honoured on this renderer.
//
// `iconName` IS ACCEPTED AND NOT DRAWN. React Native resolves no icon theme, so there is
// nothing to turn `folder-download-symbolic` — or the `image-missing` an empty slot
// resolves to — into. What this half keeps is the icon's LAYOUT, because that is the part
// that changes the button: the slot is in the row and it expands or does not.
// `button-content.native.spec.tsx` pins the empty slot, so a later edit that starts
// drawing something has to say so rather than quietly filling it.
//
// THE STYLE CLASS IS NOT STAMPED ANYWHERE, and cannot be: `adw_button_content_root` puts
// `image-text-button` on the nearest `GtkButton` ancestor, and this package ships no
// button for it to find. `buttonContentStyleTargetIndex` holds the RETARGET rule for a
// renderer that has a tree to walk; when a button lands here, that is the call to make.

import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import {
    BUTTON_CONTENT_BOX_SPACING,
    buttonContentEllipsize,
    buttonContentIconExpands,
    buttonContentLabelText,
    buttonContentLabelVisible,
} from '@gjsify/adwaita-core';

import type { AdwButtonContentProps } from '../props.js';

/** {@link import('./button-content.js').AdwButtonContent} on React Native. */
export function AdwButtonContent({ label, useUnderline, canShrink }: AdwButtonContentProps): ReactElement | null {
    const text = label ?? '';

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: BUTTON_CONTENT_BOX_SPACING }}>
            {/* The icon SLOT. Empty by construction — see the header — but in the row and
                carrying the `hexpand` libadwaita gives it. */}
            <View style={{ flexGrow: buttonContentIconExpands(text) ? 1 : 0 }} />
            <Text
                // `numberOfLines={0}` is React Native's "no limit", so the two ellipsize
                // modes are one expression rather than a conditional prop.
                numberOfLines={buttonContentEllipsize(canShrink ?? false) === 'end' ? 1 : 0}
                ellipsizeMode="tail"
                style={{ display: buttonContentLabelVisible(text) ? 'flex' : 'none' }}
            >
                {buttonContentLabelText(text, useUnderline ?? false)}
            </Text>
        </View>
    );
}
