// @gjsify/devtools — render a GTK widget to PNG bytes via the GSK renderer.
// Adapted from the PixelRPG map-editor (apps/maker-gjs/src/services/screenshot.ts).
// Copyright (c) PixelRPG. MIT.

import Graphene from 'gi://Graphene?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * Why a capture could not be made. Four distinct absences, and telling them apart is
 * the whole point of this type.
 *
 * A `null` with no reason is how this file used to answer, and the service above turns
 * a failed capture into ZERO BYTES on the wire — a deliberate contract, so the MCP
 * tool can retry a window that is not up yet. The two together are silent, and a
 * silent empty PNG is read by whoever receives it as a statement about what the tool
 * cannot do: MEASURED consequence, an empty reply from a window with a playing video
 * was published in a consumer's README as "the devtools `Screenshot` returns nothing
 * with a live video texture", which is false — the same window answers 308 714 bytes.
 * The capture had declined for one of the other three reasons and said nothing.
 */
export type CaptureBlocker =
    /** Not realised: no `Gtk.Native`, or a native with no `Gsk.Renderer` yet. */
    | 'no-renderer'
    /** Realised but not allocated — mid-layout, or a window between two sizes. */
    | 'zero-size'
    /** Nothing to draw: `Gtk.Snapshot.to_node()` answered null. */
    | 'empty-snapshot'
    /** Rendered, and the PNG serialiser handed back no bytes. */
    | 'empty-png';

/** A capture, or the reason there is none. */
export type CaptureResult =
    | { readonly png: Uint8Array; readonly blocker?: undefined }
    | { readonly png: null; readonly blocker: CaptureBlocker };

/**
 * Render a GTK widget — typically the top-level window — to PNG bytes, fully
 * in-process via the GSK renderer. No external screenshot tools, no
 * compositor portal: the widget's own `Gsk.Renderer` rasterises a
 * `Gtk.WidgetPaintable` snapshot to a `Gdk.Texture`, serialised to PNG.
 *
 * A LIVE VIDEO IS NOT ONE OF THE REASONS THIS DECLINES, which is worth stating where
 * a reader would look for it: measured on GTK 4.22.4 with `GskVulkanRenderer`, a
 * `gtk4paintablesink` paintable in a `Gtk.Picture` captures at 202 645 bytes for the
 * picture alone and 204 865 for its window, both with `videotestsrc` and with a real
 * HLS stream. The renderer downloads the texture like any other.
 */
export function captureWidget(widget: Gtk.Widget): CaptureResult {
    const native = widget.get_native();
    const renderer = native?.get_renderer();
    if (!renderer) return { png: null, blocker: 'no-renderer' };

    const width = widget.get_width();
    const height = widget.get_height();
    if (width <= 0 || height <= 0) return { png: null, blocker: 'zero-size' };

    const paintable = Gtk.WidgetPaintable.new(widget);
    const snapshot = Gtk.Snapshot.new();
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node) return { png: null, blocker: 'empty-snapshot' };

    const viewport = new Graphene.Rect();
    viewport.init(0, 0, width, height);
    const texture = renderer.render_texture(node, viewport);

    const data = texture.save_to_png_bytes().get_data();
    if (!data) return { png: null, blocker: 'empty-png' };
    return { png: new Uint8Array(data) };
}

/** The bytes alone, for callers that have nothing to do with the reason. */
export function captureWidgetPng(widget: Gtk.Widget): Uint8Array | null {
    return captureWidget(widget).png;
}
