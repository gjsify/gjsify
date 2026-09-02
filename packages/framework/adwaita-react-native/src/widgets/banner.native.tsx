/** @jsxImportSource react */
// `AdwBanner` on React Native. (On the pragma, see `bin.native.tsx`.)
//
// THE OMITTED DEFAULTS ARE THE ONES THE WIDGET READS BACK, NOT THE ONES IT DECLARES, and
// for `use-markup` those differ. `ADW_BANNER_DEFAULTS` is not used here for that reason
// and only that one: the constant faithfully records a `GParamSpec` default of TRUE that
// libadwaita never applies, because `adw_banner_get_use_markup` delegates to the title
// label and `adw-banner.ui` leaves that label on `GtkLabel`'s own FALSE. Measured on
// 1.9.3, `new Adw.Banner().use_markup` is FALSE. The full account is in `props.ts`; the
// consequence here is that both halves answer the same for an omitted value, which is the
// only agreement this package is trying to buy.
//
// MARKUP IS REDUCED TO ITS PLAIN TEXT, with the core's own `stripMarkup` — the same call
// `@gjsify/adwaita-nativescript` makes, for the same reason: React Native has no inline
// markup layer, and painting `<b>Metered</b>` literally is further from what GTK draws
// than painting `Metered` is. Unparseable markup keeps the raw string, which is Pango's
// own fallback.
//
// `revealed` IS `display: 'none'`, NOT AN UNMOUNT. `Adw.Banner` reveals through a
// `GtkRevealer`, which keeps the widget and takes it out of the allocation; `display:
// 'none'` is Yoga's spelling of that. Returning `null` would additionally unmount, so a
// banner that is revealed and hidden again would rebuild rather than slide.
//
// THE SUGGESTED STYLE IS THE ACCENT COLOUR, BECAUSE THAT IS WHAT THE CLASS MEANS. There is
// no class system to stamp `suggested-action` into — the same wall `AdwClamp`'s size class
// hits — but the class is not decoration: Adwaita paints it with the accent background and
// `ADW_ACCENT_FG_COLOR` on top, and both are in the core. `useSyncExternalStore` over
// `onAdwaitaAccentChanged` is what makes a later `setAdwaitaAccent` repaint the button;
// reading `adwaitaAccent()` during render alone would freeze it at whatever the accent was
// on first paint.

import { useSyncExternalStore, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import {
    ADW_ACCENT_FG_COLOR,
    adwaitaAccent,
    adwaitaAccentBgColor,
    bannerButtonStyleClasses,
    bannerButtonText,
    bannerButtonVisible,
    onAdwaitaAccentChanged,
    parseBannerButtonStyle,
    stripMarkup,
} from '@gjsify/adwaita-core';

import type { AdwBannerProps } from '../props.js';

/** `.suggested-action`, which is the only class `button-style` manages. */
const SUGGESTED_ACTION = 'suggested-action';

/**
 * `onAdwaitaAccentChanged` as `useSyncExternalStore`'s `subscribe`.
 *
 * Hoisted to module scope on purpose: the hook resubscribes whenever this argument
 * changes identity, so an inline arrow would tear down and re-add the listener on every
 * render of every banner on screen.
 */
const onAdwaitaAccentChangedStore = (notify: () => void): (() => void) => onAdwaitaAccentChanged(notify);

/** {@link import('./banner.js').AdwBanner} on React Native. */
export function AdwBanner({
    title,
    buttonLabel,
    revealed,
    useMarkup,
    buttonStyle,
    onButtonClicked,
}: AdwBannerProps): ReactElement | null {
    const accent = useSyncExternalStore(onAdwaitaAccentChangedStore, adwaitaAccent, adwaitaAccent);

    const message = title ?? '';
    const label = buttonLabel ?? '';
    const suggested = bannerButtonStyleClasses(parseBannerButtonStyle(buttonStyle)).includes(SUGGESTED_ACTION);

    return (
        <View style={{ display: (revealed ?? false) ? 'flex' : 'none', flexDirection: 'row', alignItems: 'center' }}>
            {/* The template pins the TITLE to `use-underline=False`, so its
                underscores are literal and `bannerButtonText` must not touch it. */}
            <Text style={{ flexGrow: 1 }}>{(useMarkup ?? false) ? (stripMarkup(message) ?? message) : message}</Text>
            <Text
                accessibilityRole="button"
                onPress={onButtonClicked}
                style={{
                    display: bannerButtonVisible(label) ? 'flex' : 'none',
                    backgroundColor: suggested ? adwaitaAccentBgColor(accent) : undefined,
                    color: suggested ? ADW_ACCENT_FG_COLOR : undefined,
                }}
            >
                {bannerButtonText(label)}
            </Text>
        </View>
    );
}
