// getUserMedia for GJS — wraps GStreamer source elements as MediaStreamTracks.
//
// Phase 3: basic media capture. Tries real audio/video sources first
// (pipewiresrc, pulsesrc, v4l2src), falls back to test sources.
// Phase 4.3: constraint support — width, height, frameRate, sampleRate,
// channelCount mapped to GStreamer capsfilter elements.
//
// Reference: W3C Media Capture and Streams spec § 10.3

import { Gst, ensureGstInit } from './gst-init.js';
import { MediaStreamTrack } from './media-stream-track.js';
import { MediaStream } from './media-stream.js';

export interface MediaTrackConstraints {
    deviceId?: string;
    sampleRate?: number;
    channelCount?: number;
    width?: number;
    height?: number;
    frameRate?: number;
}

export interface MediaStreamConstraints {
    audio?: boolean | MediaTrackConstraints;
    video?: boolean | MediaTrackConstraints;
}

export async function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    ensureGstInit();

    if (!constraints.audio && !constraints.video) {
        throw new TypeError(
            "Failed to execute 'getUserMedia': At least one of audio or video must be requested",
        );
    }

    const tracks: MediaStreamTrack[] = [];

    if (constraints.audio) {
        const audioConstraints = typeof constraints.audio === 'object' ? constraints.audio : {};
        const source = _createAudioSource();
        const pipeline = new Gst.Pipeline() as any;
        pipeline.add(source);

        // Apply audio constraints via capsfilter
        const capsStr = _buildAudioCaps(audioConstraints);
        if (capsStr) {
            const capsfilter = Gst.ElementFactory.make('capsfilter', null)!;
            (capsfilter as any).caps = Gst.Caps.from_string(capsStr);
            pipeline.add(capsfilter);
            source.link(capsfilter);
        }

        tracks.push(new MediaStreamTrack({
            kind: 'audio',
            label: source.name ?? 'audio',
            _gst: { source, pipeline },
        }));
    }

    if (constraints.video) {
        const videoConstraints = typeof constraints.video === 'object' ? constraints.video : {};
        const source = _createVideoSource();
        const pipeline = new Gst.Pipeline() as any;
        pipeline.add(source);

        // Apply video constraints via capsfilter
        const capsStr = _buildVideoCaps(videoConstraints);
        if (capsStr) {
            const capsfilter = Gst.ElementFactory.make('capsfilter', null)!;
            (capsfilter as any).caps = Gst.Caps.from_string(capsStr);
            pipeline.add(capsfilter);
            source.link(capsfilter);
        }

        tracks.push(new MediaStreamTrack({
            kind: 'video',
            label: source.name ?? 'video',
            _gst: { source, pipeline },
        }));
    }

    return new MediaStream(tracks);
}

/** Build a GStreamer caps string for audio constraints. */
function _buildAudioCaps(c: MediaTrackConstraints): string | null {
    const parts: string[] = [];
    if (c.sampleRate != null) parts.push(`rate=${Math.trunc(c.sampleRate)}`);
    if (c.channelCount != null) parts.push(`channels=${Math.trunc(c.channelCount)}`);
    if (parts.length === 0) return null;
    return `audio/x-raw,${parts.join(',')}`;
}

/** Build a GStreamer caps string for video constraints. */
function _buildVideoCaps(c: MediaTrackConstraints): string | null {
    const parts: string[] = [];
    if (c.width != null) parts.push(`width=${Math.trunc(c.width)}`);
    if (c.height != null) parts.push(`height=${Math.trunc(c.height)}`);
    if (c.frameRate != null) parts.push(`framerate=${Math.trunc(c.frameRate)}/1`);
    if (parts.length === 0) return null;
    return `video/x-raw,${parts.join(',')}`;
}

function _createAudioSource(): any {
    // Try real sources in priority order
    for (const name of ['pipewiresrc', 'pulsesrc', 'autoaudiosrc']) {
        const el = Gst.ElementFactory.make(name, null);
        if (el) {
            try { (el as any).is_live = true; } catch { /* not all sources have is-live */ }
            return el;
        }
    }
    // Fallback: test source (sine wave, audible for debugging)
    const el = Gst.ElementFactory.make('audiotestsrc', null)!;
    (el as any).is_live = true;
    (el as any).wave = 0; // sine
    return el;
}

function _createVideoSource(): any {
    for (const name of ['pipewiresrc', 'v4l2src', 'autovideosrc']) {
        const el = Gst.ElementFactory.make(name, null);
        if (el) return el;
    }
    // Fallback: test pattern
    const el = Gst.ElementFactory.make('videotestsrc', null)!;
    (el as any).is_live = true;
    (el as any).pattern = 0; // SMPTE bars
    return el;
}
