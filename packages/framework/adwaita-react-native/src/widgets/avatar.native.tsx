/** @jsxImportSource react */
// `AdwAvatar` on React Native — libadwaita's own initials and its own palette entry.
// (On the pragma, see `bin.native.tsx`.)
//
// `@gjsify/adwaita-core` DOES BOTH DERIVATIONS AND THIS FILE PAINTS THEM. `avatarInitials`
// is `extract_initials_from_text` — upcase, strip, NFC, then CODE POINTS, so an astral
// first letter survives where `charAt(0)` would return half a surrogate pair. `avatarColor`
// is `set_class_color`: `g_str_hash` over the UTF-8 BYTES as a signed char, `% 14`. Both
// details decide whether an accented name gets the same avatar here as on GTK, and both
// were wrong in two renderers before the port existed.
//
// THE GRADIENT IS FLATTENED, WITH THE SAME CALL THE NATIVESCRIPT RENDERER MAKES.
// `$avatarcolorlist` is a `start`→`stop` gradient and a React Native style has no gradient
// key, so `flattenAvatarGradient` collapses it to the 50/50 blend — a core function rather
// than a private average, because a second averaging is a second answer.
//
// THE FONT SIZE IS THE CAP, NOT A MEASUREMENT, and the core sanctions exactly that:
// `update_font_size` scales the label's measured ASPECT RATIO against
// `avatarMaxFontSize(size)`, and a renderer that cannot measure text may use the cap
// alone and stay inside libadwaita's bound. React Native reports a text box only through
// `onLayout`, i.e. after layout, which is the same missing measure pass that makes
// `AdwClamp` pass `childMin: 0`. What is NOT done here is the 0.4 heuristic the
// NativeScript port carries: it is not monotonic in `size` and it exceeded the cap above
// ~54 points.
//
// `iconName` IS ACCEPTED AND NOT DRAWN, and the spec pins that rather than leaving it
// silent. React Native resolves no icon theme, so there is no glyph to put in the circle
// for `adw-avatar-default-symbolic`; what the icon mode produces here is the coloured
// circle with the initials hidden. The GTK half draws the real symbolic, so this is a
// one-directional divergence and the README names it.
//
// THE BACKGROUND IS PAINTED IN ICON MODE TOO. Measured on libadwaita 1.9.3: an avatar
// with `show-initials` FALSE still carries `color11` on its gizmo, so the circle keeps its
// colour and only the initials go away. The browser renderer clears its background there;
// this half follows the widget.

import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import {
    avatarColor,
    avatarInitials,
    avatarMaxFontSize,
    avatarMode,
    flattenAvatarGradient,
} from '@gjsify/adwaita-core';

import type { AdwAvatarProps } from '../props.js';

/** {@link import('./avatar.js').AdwAvatar} on React Native. */
export function AdwAvatar({ size, text, showInitials }: AdwAvatarProps): ReactElement | null {
    const name = text ?? '';
    const color = avatarColor(name);
    // `hasCustomImage` is FALSE for the life of this half — `custom-image` is a
    // `GdkPaintable` and is absent from the surface (`props.ts`), so the `'image'` branch
    // of `update_visibility` is unreachable here and only `'initials'`/`'icon'` remain.
    // The gate is the TEXT and not the derived initials, which is why a whitespace-only
    // name is in initials mode with a blank label rather than falling back to the icon.
    const mode = avatarMode({ hasCustomImage: false, showInitials: showInitials ?? false, text: name });

    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: flattenAvatarGradient(color),
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            {/* The label is HIDDEN rather than unmounted in icon mode, which is
                `gtk_widget_set_visible (self->label, …)` — libadwaita keeps the node. */}
            <Text
                style={{
                    color: color.fg,
                    fontSize: avatarMaxFontSize(size),
                    display: mode === 'initials' ? 'flex' : 'none',
                }}
            >
                {avatarInitials(name)}
            </Text>
        </View>
    );
}
