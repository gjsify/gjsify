// Draws an icon value into an `Image`, for the two widgets that rasterise one (`GtkImage`,
// `AdwImageButton`). `resolveIconDrawing` decides what the value draws as, over the shared
// `Gtk.IconTheme`'s resource paths (ADR 0116 § 4); this file turns the answer into an
// `ImageSource`, and re-runs it when the theme changes, as a `GtkImage` re-runs its lookup.
//
// Original implementation.

import { ImageSource, Screen, type Image } from '@nativescript/core';

import { IconTheme } from '../namespace/gtk-platform.js';
import { onIconThemeChanged, resolveIconDrawing } from './icon-theme.js';
import { renderSymbolicIcon } from './icons.js';

const theme = IconTheme.get_for_display(null);

/**
 * Draw `value` into `image` at `size` DIPs. A symbolic drawing is filled with `color`, a
 * `.symbolic.png` tinted with it, any other PNG drawn as it is. `''` leaves the image alone, and
 * so does a glyph the platform cannot rasterise (off a device, `renderSymbolicIcon` draws nothing).
 */
export function drawIcon(image: Image, value: string, size: number, color: string): void {
    const drawing = resolveIconDrawing(theme, value, { size, scale: Screen.mainScreen?.scale || 1 });
    if (drawing === null) return;
    if (drawing.kind === 'svg') {
        const source = renderSymbolicIcon(drawing.svg, { size, color });
        if (source === null) return;
        image.tintColor = undefined;
        image.imageSource = source;
        return;
    }
    image.tintColor = drawing.symbolic ? color : undefined;
    image.imageSource = ImageSource.fromBase64Sync(drawing.base64);
}

/** Run `redraw` whenever the shared icon theme changes. Returns the unsubscribe function. */
export function onIconsChanged(redraw: () => void): () => void {
    return onIconThemeChanged(theme, redraw);
}
