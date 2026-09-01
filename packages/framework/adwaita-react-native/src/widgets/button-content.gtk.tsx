/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwButtonContent` on GTK — the real `Adw.ButtonContent`. (On the pragma, see
// `bin.gtk.tsx`.)
//
// THE LABEL GOES IN RAW, mnemonic marker and all, and that is not the same rule the
// React Native half follows. `AdwButtonContent`'s label node carries `use-underline`
// itself, so libadwaita resolves the marker at PAINT time and reading the property back
// gives `"_Save"` — measured. `buttonContentLabelText` exists for a renderer with no
// mnemonic layer, which is the other half; running it here would delete an underscore
// libadwaita is still going to interpret, i.e. strip it twice.
//
// The parent-button style class is libadwaita's own work here: `adw_button_content_root`
// puts `image-text-button` on the nearest `GtkButton` — measured, the button's
// `css-classes` reads `["image-text-button"]` — and `buttonContentStyleTargetIndex` is
// for a renderer that has to walk its own tree. This one does not have a tree to walk.

import type { ReactElement } from 'react';

import type { AdwButtonContentProps } from '../props.js';

/** {@link import('./button-content.js').AdwButtonContent} on GTK. */
export function AdwButtonContent({
    iconName,
    label,
    useUnderline,
    canShrink,
}: AdwButtonContentProps): ReactElement | null {
    return (
        <adw-button-content icon-name={iconName} label={label} use-underline={useUnderline} can-shrink={canShrink} />
    );
}
