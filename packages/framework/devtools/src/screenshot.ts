// @gjsify/devtools — render a GTK widget to PNG bytes via the GSK renderer.
// Adapted from the PixelRPG map-editor (apps/maker-gjs/src/services/screenshot.ts).
// Copyright (c) PixelRPG. MIT.

import Graphene from 'gi://Graphene?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * Render a GTK widget — typically the top-level window — to PNG bytes, fully
 * in-process via the GSK renderer. No external screenshot tools, no
 * compositor portal: the widget's own `Gsk.Renderer` rasterises a
 * `Gtk.WidgetPaintable` snapshot to a `Gdk.Texture`, serialised to PNG.
 *
 * Returns `null` when the widget isn't realised yet (no renderer or zero
 * size) so callers can surface a clear "not ready" error instead of an empty
 * image.
 */
export function captureWidgetPng(widget: Gtk.Widget): Uint8Array | null {
    const native = widget.get_native();
    const renderer = native?.get_renderer();
    if (!renderer) return null;

    const width = widget.get_width();
    const height = widget.get_height();
    if (width <= 0 || height <= 0) return null;

    const paintable = Gtk.WidgetPaintable.new(widget);
    const snapshot = Gtk.Snapshot.new();
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node) return null;

    const viewport = new Graphene.Rect();
    viewport.init(0, 0, width, height);
    const texture = renderer.render_texture(node, viewport);

    const data = texture.save_to_png_bytes().get_data();
    return data ? new Uint8Array(data) : null;
}
