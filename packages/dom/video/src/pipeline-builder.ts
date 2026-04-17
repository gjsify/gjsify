// GStreamer pipeline construction for the VideoBridge.
//
// Two pipeline modes:
// 1. MediaStream (srcObject) — takes a GStreamer source element from the track
//    and wires it through videoconvert → gtk4paintablesink
// 2. URI (src) — uses playbin with gtk4paintablesink as video-sink
//
// Reference: refs/showtime/showtime/play.py (gtk4paintablesink + optional glsinkbin)

import Gdk from 'gi://Gdk?version=4.0';
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

    const paintable: Gdk.Paintable = (paintableSink as any).paintable;
    if (!paintable) {
        throw new Error('gtk4paintablesink has no paintable property');
    }

    // Try GL-accelerated rendering via glsinkbin (pattern from refs/showtime)
    let glSink: Gst.Element | null = null;
    const glContext = (paintable as any).gl_context;
    if (glContext) {
        glSink = Gst.ElementFactory.make('glsinkbin', 'glsink');
        if (glSink) {
            (glSink as any).sink = paintableSink;
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
}

/**
 * Build a pipeline for rendering a MediaStream video track.
 *
 * Expects the track's _gstSource element (from getUserMedia) and the
 * track's _gstPipeline. The source is removed from its original pipeline
 * (created by getUserMedia) and re-parented into a new pipeline with
 * videoconvert → gtk4paintablesink.
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
    const videoconvert = Gst.ElementFactory.make('videoconvert', 'convert');
    if (!videoconvert) {
        throw new Error('Failed to create videoconvert element');
    }

    pipeline.add(gstSource);
    pipeline.add(videoconvert);
    pipeline.add(sink);

    if (!gstSource.link(videoconvert)) {
        throw new Error('Failed to link source → videoconvert');
    }
    if (!videoconvert.link(sink)) {
        throw new Error('Failed to link videoconvert → sink');
    }

    return { pipeline, paintable };
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

    (playbin as any).uri = uri;
    (playbin as any).video_sink = sink;

    // Wrap playbin in a pipeline
    const pipeline = new Gst.Pipeline({ name: 'video-bridge-uri-pipeline' });
    pipeline.add(playbin);

    return { pipeline, paintable };
}
