/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwBanner` on GTK — the real `Adw.Banner`. (On the pragma, see `bin.gtk.tsx`.)
//
// NOTHING IS DEFAULTED HERE, and that is what makes the pair in `props.ts` measurable.
// An omitted property leaves the real widget on its own value, so `content.gtk.spec.tsx`
// reads back what libadwaita actually answers — which for `use-markup` is FALSE, against
// a `GParamSpec` that declares TRUE and a core constant that faithfully records the
// declaration. The React Native half answers FALSE for the same input. Defaulting here
// from `ADW_BANNER_DEFAULTS` would have made this half agree with the constant and
// disagree with the widget it IS.
//
// `onButtonClicked` reaches `button-clicked` through gtk-host's signal mapping, so the
// prop name is the GObject signal camelCased exactly as every other `on*` on this host.

import type { ReactElement } from 'react';

import type { AdwBannerProps } from '../props.js';

/** {@link import('./banner.js').AdwBanner} on GTK. */
export function AdwBanner({
    title,
    buttonLabel,
    revealed,
    useMarkup,
    buttonStyle,
    onButtonClicked,
}: AdwBannerProps): ReactElement | null {
    return (
        <adw-banner
            title={title}
            button-label={buttonLabel}
            revealed={revealed}
            use-markup={useMarkup}
            button-style={buttonStyle}
            onButtonClicked={onButtonClicked}
        />
    );
}
