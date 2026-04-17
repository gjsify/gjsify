// getUserMedia for GJS — wraps GStreamer source elements as MediaStreamTracks.
//
// Phase 3: basic media capture. Tries real audio/video sources first
// (pipewiresrc, pulsesrc, v4l2src), falls back to test sources.
// Constraint support is minimal (boolean audio/video only).
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
        const source = _createAudioSource();
        const pipeline = new Gst.Pipeline() as any;
        pipeline.add(source);
        tracks.push(new MediaStreamTrack({
            kind: 'audio',
            label: source.name ?? 'audio',
            _gst: { source, pipeline },
        }));
    }

    if (constraints.video) {
        const source = _createVideoSource();
        const pipeline = new Gst.Pipeline() as any;
        pipeline.add(source);
        tracks.push(new MediaStreamTrack({
            kind: 'video',
            label: source.name ?? 'video',
            _gst: { source, pipeline },
        }));
    }

    return new MediaStream(tracks);
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
