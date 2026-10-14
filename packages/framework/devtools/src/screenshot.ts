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

/** Options for {@link captureWidget}. */
export interface CaptureOptions {
    /**
     * Device pixels per logical pixel. Defaults to the widget's own
     * `get_scale_factor()`, so a window on a HiDPI monitor captures at the
     * resolution it is actually drawn at.
     */
    readonly scale?: number;
}

/**
 * The scale a capture uses when the caller names none: the widget's own
 * `Gtk.Widget.get_scale_factor()`, clamped to a usable positive number.
 *
 * A widget handed in from a duck-typed test, or one not yet attached to a
 * surface, may answer 0 or nothing at all — that is not a request for a
 * zero-pixel image, it is an absent answer, and 1 is what the capture did
 * before scaling existed.
 */
export function defaultCaptureScale(widget: Gtk.Widget): number {
    const factor = widget.get_scale_factor?.();
    return typeof factor === 'number' && factor > 0 ? factor : 1;
}

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
 *
 * THE SCALE IS A GSK TRANSFORM AND IT GENUINELY RE-RASTERISES — the question every
 * reader of this function asks, measured rather than assumed. `Gtk.Snapshot.scale()`
 * before `paintable.snapshot()` makes the whole subtree draw into a viewport `scale`
 * times larger, and text and symbolic icons come out re-rendered at that resolution,
 * not magnified: Laplacian variance against a bicubic 2× upscale of the same 1×
 * capture is 5–6× for a whole window, 7.35× for a symbolic icon and 7.04× for a
 * full-colour themed icon. The control in the same probe is a RASTER texture at its
 * native size, which scores 0.42× — it cannot gain detail it never had, and its being
 * the only thing that does not prove the metric reads rasterisation rather than
 * magnification. So an app's own PNG assets stay as sharp as the file they came from;
 * everything GTK draws gets sharper.
 *
 * THE MONITOR'S SCALE DOES NOT REACH THIS CAPTURE. Only the transform does: the same
 * window captured under a compositor at scale 1, 1.25 and 2 produces byte-identical
 * PNGs (md5 `1294b43d…` at every monitor scale, `916c5a02…` once `scale: 2` is passed).
 * This is why a HiDPI capture never happened by itself on a HiDPI screen, and why a CI
 * runner under Xvfb at scale 1 can still prove the 2× path exactly.
 */
export function captureWidget(widget: Gtk.Widget, options: CaptureOptions = {}): CaptureResult {
    const native = widget.get_native();
    const renderer = native?.get_renderer();
    if (!renderer) return { png: null, blocker: 'no-renderer' };

    const width = widget.get_width();
    const height = widget.get_height();
    if (width <= 0 || height <= 0) return { png: null, blocker: 'zero-size' };

    const scale = options.scale && options.scale > 0 ? options.scale : defaultCaptureScale(widget);

    const paintable = Gtk.WidgetPaintable.new(widget);
    const snapshot = Gtk.Snapshot.new();
    // Scale FIRST, then snapshot at the logical size: the paintable lays out in logical
    // pixels and the transform multiplies everything it draws, so the node covers
    // `width * scale × height * scale` device pixels.
    if (scale !== 1) snapshot.scale(scale, scale);
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node) return { png: null, blocker: 'empty-snapshot' };

    const viewport = new Graphene.Rect();
    viewport.init(0, 0, width * scale, height * scale);
    const texture = renderer.render_texture(node, viewport);

    const data = texture.save_to_png_bytes().get_data();
    if (!data) return { png: null, blocker: 'empty-png' };
    return { png: new Uint8Array(data) };
}

/** The bytes alone, for callers that have nothing to do with the reason. */
export function captureWidgetPng(widget: Gtk.Widget, options: CaptureOptions = {}): Uint8Array | null {
    return captureWidget(widget, options).png;
}
