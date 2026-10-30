// getUserMedia for GJS — wraps GStreamer source elements as MediaStreamTracks.
//
// Source selection, deviceId binding and constraint caps live in
// `@gjsify/media-capture` (ADR 0127); this file wraps what it opens as
// MediaStreamTracks.
//
// Reference: W3C Media Capture and Streams spec § 10.3

import { ensureGstInit, openCapture, type CaptureConstraints } from '@gjsify/media-capture';
import { MediaStreamTrack } from './media-stream-track.js';
import { MediaStream } from './media-stream.js';

export type MediaTrackConstraints = CaptureConstraints;

export interface MediaStreamConstraints {
    audio?: boolean | MediaTrackConstraints;
    video?: boolean | MediaTrackConstraints;
}

export async function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    ensureGstInit();

    if (!constraints.audio && !constraints.video) {
        throw new TypeError("Failed to execute 'getUserMedia': At least one of audio or video must be requested");
    }

    const tracks: MediaStreamTrack[] = [];

    for (const kind of ['audio', 'video'] as const) {
        const requested = constraints[kind];
        if (!requested) continue;
        const { source, pipeline } = openCapture(kind, typeof requested === 'object' ? requested : {});
        tracks.push(
            new MediaStreamTrack({
                kind,
                label: source.name ?? kind,
                _gst: { source, pipeline },
            }),
        );
    }

    return new MediaStream(tracks);
}
