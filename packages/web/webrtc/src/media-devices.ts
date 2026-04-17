// W3C MediaDevices for GJS.
//
// Phase 3: getUserMedia via GStreamer sources. enumerateDevices is a stub.
//
// Reference: W3C Media Capture and Streams spec § 10.2

import '@gjsify/dom-events/register/event-target';

import { getUserMedia, type MediaStreamConstraints } from './get-user-media.js';
import type { MediaStream } from './media-stream.js';

export class MediaDevices extends EventTarget {
    private _ondevicechange: ((ev: Event) => void) | null = null;

    get ondevicechange(): ((ev: Event) => void) | null { return this._ondevicechange; }
    set ondevicechange(v: ((ev: Event) => void) | null) { this._ondevicechange = v; }

    async getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream> {
        if (!constraints) {
            throw new TypeError(
                "Failed to execute 'getUserMedia' on 'MediaDevices': At least one of audio or video must be requested",
            );
        }
        return getUserMedia(constraints);
    }

    async enumerateDevices(): Promise<any[]> {
        // Phase 4: GStreamer Device Monitor
        return [];
    }

    getSupportedConstraints(): Record<string, boolean> {
        return {
            deviceId: false,
            width: false,
            height: false,
            frameRate: false,
            sampleRate: false,
            channelCount: false,
        };
    }
}
