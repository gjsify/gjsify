// GStreamer pipeline construction for the VideoBridge.
//
// Two pipeline modes:
// 1. MediaStream (srcObject) — takes a GStreamer source element from the track
//    and wires it through videoconvert → gtk4paintablesink
// 2. URI (src) — uses playbin with gtk4paintablesink as video-sink
//
// Reference: refs/showtime/showtime/play.py (gtk4paintablesink + optional glsinkbin)

import type Gdk from 'gi://Gdk?version=4.0';
import { ensureGstInit, ensurePaintableSinkAvailable, Gst } from './gst-init.js';

export interface PaintableSinkResult {
    sink: Gst.Element;
    paintable: Gdk.Paintable;
    glSink: Gst.Element | null;
}

/**
 * Create a gtk4paintablesink and extract its Gdk.Paintable.
 * Optionally wraps in glsinkbin for GL-accelerated rendering
 * (following the showtime pattern).
 */
export function createPaintableSink(): PaintableSinkResult {
    ensurePaintableSinkAvailable();

    const paintableSink = Gst.ElementFactory.make('gtk4paintablesink', 'videosink');
    if (!paintableSink) {
        throw new Error('Failed to create gtk4paintablesink element');
    }

    /**
     * GStreamer element GObject-properties are typed dynamically. The
     * `gtk4paintablesink` element ships a `paintable` property (a
     * `Gdk.Paintable`), a `glsinkbin` element a `sink` property (a child
     * `Gst.Element`), and `playbin` exposes `uri` + `video_sink`. None of
     * these surface in the GIR-generated `Gst.Element` typings, so we cast
     * once through a local structural type and let the property accesses
     * stay readable.
     */
    interface _PaintableSink extends Gst.Element {
        paintable: Gdk.Paintable & { gl_context?: unknown };
    }
    interface _GlSinkBin extends Gst.Element { sink: Gst.Element }

    const paintable: Gdk.Paintable & { gl_context?: unknown } =
        (paintableSink as _PaintableSink).paintable;
    if (!paintable) {
        throw new Error('gtk4paintablesink has no paintable property');
    }

    // Try GL-accelerated rendering via glsinkbin (pattern from refs/showtime)
    let glSink: Gst.Element | null = null;
    const glContext = paintable.gl_context;
    if (glContext) {
        glSink = Gst.ElementFactory.make('glsinkbin', 'glsink');
        if (glSink) {
            (glSink as _GlSinkBin).sink = paintableSink;
        }
    }

    return {
        sink: glSink ?? paintableSink,
        paintable,
        glSink,
    };
}

export interface MediaStreamPipelineResult {
    pipeline: Gst.Pipeline;
    paintable: Gdk.Paintable;
    /** The tee element inserted after the source for fan-out to other consumers (e.g. WebRTC). Only present for MediaStream pipelines. */
    tee?: Gst.Element;
}

/**
 * Build a pipeline for rendering a MediaStream video track.
 *
 * Expects the track's _gstSource element (from getUserMedia) and the
 * track's _gstPipeline. The source is removed from its original pipeline
 * (created by getUserMedia) and re-parented into a new pipeline with:
 *   source → tee → queue → videoconvert → gtk4paintablesink
 *
 * The tee element allows other consumers (e.g. RTCPeerConnection.addTrack)
 * to request additional branches without moving the source across pipelines.
 */
export function buildMediaStreamPipeline(gstSource: any, gstPipeline: any): MediaStreamPipelineResult {
    ensureGstInit();
    const { sink, paintable } = createPaintableSink();

    // The source lives in the pipeline created by getUserMedia.
    // Stop that pipeline and remove the source so we can re-parent it.
    if (gstPipeline) {
        gstPipeline.set_state(Gst.State.NULL);
        gstPipeline.remove(gstSource);
    }

    const pipeline = new Gst.Pipeline({ name: 'video-bridge-pipeline' });

    // Insert a tee after the source so that additional consumers (e.g. WebRTC
    // encoder chain) can tap into the same source without cross-pipeline issues.
    const tee = Gst.ElementFactory.make('tee', 'source-tee');
    if (!tee) {
        throw new Error('Failed to create tee element');
    }
    // tee's `allow-not-linked` GObject-property — not typed on Gst.Element.
    (tee as Gst.Element & { allow_not_linked: boolean }).allow_not_linked = true;

    const queue = Gst.ElementFactory.make('queue', 'preview-queue');
    if (!queue) {
        throw new Error('Failed to create queue element');
    }

    const videoconvert = Gst.ElementFactory.make('videoconvert', 'convert');
    if (!videoconvert) {
        throw new Error('Failed to create videoconvert element');
    }

    pipeline.add(gstSource);
    pipeline.add(tee);
    pipeline.add(queue);
    pipeline.add(videoconvert);
    pipeline.add(sink);

    // source → tee
    if (!gstSource.link(tee)) {
        throw new Error('Failed to link source → tee');
    }

    // tee → queue (via request pad)
    // Older GStreamer versions exposed `get_request_pad`; newer ones
    // renamed it to `request_pad_simple`. Probe both shapes structurally
    // so the call works against either typelib.
    const teeWithLegacy = tee as Gst.Element & {
        get_request_pad?: (name: string) => Gst.Pad | null;
    };
    const teeSrcPad = tee.request_pad_simple
        ? tee.request_pad_simple('src_%u')
        : teeWithLegacy.get_request_pad?.('src_%u') ?? null;
    const queueSinkPad = queue.get_static_pad('sink');
    if (teeSrcPad && queueSinkPad) {
        teeSrcPad.link(queueSinkPad);
    } else {
        throw new Error('Failed to link tee → queue');
    }

    // queue → videoconvert → sink
    if (!queue.link(videoconvert)) {
        throw new Error('Failed to link queue → videoconvert');
    }
    if (!videoconvert.link(sink)) {
        throw new Error('Failed to link videoconvert → sink');
    }

    return { pipeline, paintable, tee };
}

/**
 * Build a pipeline for playing a URI (video.src = "file:///..." or URL).
 *
 * Uses GStreamer playbin with gtk4paintablesink as video-sink.
 */
export function buildUriPipeline(uri: string): MediaStreamPipelineResult {
    ensureGstInit();
    const { sink, paintable } = createPaintableSink();

    const playbin = Gst.ElementFactory.make('playbin', 'playbin');
    if (!playbin) {
        throw new Error('Failed to create playbin element');
    }

    // playbin GObject properties — not surfaced on Gst.Element.
    interface _Playbin extends Gst.Element { uri: string; video_sink: Gst.Element }
    (playbin as _Playbin).uri = uri;
    (playbin as _Playbin).video_sink = sink;

    // Wrap playbin in a pipeline
    const pipeline = new Gst.Pipeline({ name: 'video-bridge-uri-pipeline' });
    pipeline.add(playbin);

    return { pipeline, paintable };
}
