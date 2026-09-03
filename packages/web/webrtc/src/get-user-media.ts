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

/**
 * Structural shape for GStreamer element GObject-properties we set
 * dynamically (none of these are typed on `Gst.Element` from the GIR
 * bindings; GStreamer exposes them as runtime properties).
 */
interface _GstElementProps extends Gst.Element {
    caps?: Gst.Caps;
    is_live?: boolean;
    /** audiotestsrc: 0=sine, 1=square, 2=saw, 3=triangle, ... */
    wave?: number;
    /** videotestsrc: 0=SMPTE bars, 1=snow, ... */
    pattern?: number;
}

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
        throw new TypeError("Failed to execute 'getUserMedia': At least one of audio or video must be requested");
    }

    const tracks: MediaStreamTrack[] = [];

    if (constraints.audio) {
        const audioConstraints = typeof constraints.audio === 'object' ? constraints.audio : {};
        const source = _createAudioSource();
        const pipeline = new Gst.Pipeline();
        pipeline.add(source);

        // Apply audio constraints via capsfilter
        const capsStr = _buildAudioCaps(audioConstraints);
        if (capsStr) {
            const capsfilter = Gst.ElementFactory.make('capsfilter', null)!;
            (capsfilter as _GstElementProps).caps = Gst.Caps.from_string(capsStr);
            pipeline.add(capsfilter);
            source.link(capsfilter);
        }

        tracks.push(
            new MediaStreamTrack({
                kind: 'audio',
                label: source.name ?? 'audio',
                _gst: { source, pipeline },
            }),
        );
    }

    if (constraints.video) {
        const videoConstraints = typeof constraints.video === 'object' ? constraints.video : {};
        const source = _createVideoSource();
        const pipeline = new Gst.Pipeline();
        pipeline.add(source);

        // Apply video constraints via capsfilter
        const capsStr = _buildVideoCaps(videoConstraints);
        if (capsStr) {
            const capsfilter = Gst.ElementFactory.make('capsfilter', null)!;
            (capsfilter as _GstElementProps).caps = Gst.Caps.from_string(capsStr);
            pipeline.add(capsfilter);
            source.link(capsfilter);
        }

        tracks.push(
            new MediaStreamTrack({
                kind: 'video',
                label: source.name ?? 'video',
                _gst: { source, pipeline },
            }),
        );
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

/**
 * How long a candidate source gets before the probe stops waiting. Only a
 * definitive FAILURE rejects a candidate; a source still ASYNC after this
 * window is KEPT, because a live capture device that has not prerolled yet is
 * slow, not broken. So this bounds the cost of a slow camera, never the
 * verdict: every failure measured so far arrives inside 13 ms.
 */
const _SOURCE_PROBE_TIMEOUT_MS = 500;

/**
 * Make a capture source and return it only if it actually STARTS.
 *
 * A factory that exists is not a device that opens. `gstreamer1-plugins-good`
 * ships `pulsesrc` on every Fedora, container images included, and
 * `Gst.ElementFactory.make('pulsesrc')` succeeds there whether or not a
 * PulseAudio/PipeWire daemon is listening. Selecting on factory existence alone
 * therefore handed back a source that can never produce a buffer, and made the
 * `audiotestsrc` fallback below — the one source that works on such a host —
 * unreachable, since a broken `pulsesrc` was always claimed first. Measured in
 * `ghcr.io/gjsify/ci-fedora:44`: `pulsesrc` errors with "Failed to connect:
 * Connection refused" after 0.6 ms and `autoaudiosrc` with "Could not open
 * device" after 9 ms, while `getUserMedia({ audio: true })` kept returning a
 * pulsesrc-backed track whose pipeline never left NULL. Downstream that is
 * silent: `addTrack` wires it, webrtcbin sends no RTP, and the remote peer's
 * `track` event simply never fires.
 *
 * The candidate runs in a throwaway `src ! <converter> ! fakesink` pipeline.
 * The converter is load-bearing, not decoration: `pipewiresrc ! fakesink` fails
 * caps negotiation with "stream error: target not found" even on a working
 * PipeWire host, so a probe without it would reject the BEST source on exactly
 * the developer machine it is meant to serve.
 */
function _probeSource(name: string, converter: string): Gst.Element | null {
    const src = Gst.ElementFactory.make(name, null);
    if (!src) return null;

    const convert = Gst.ElementFactory.make(converter, null);
    const sink = Gst.ElementFactory.make('fakesink', null);
    // No converter or no fakesink means no probe is possible — keep the
    // historical "factory exists" answer rather than rejecting a source we
    // were unable to ask about.
    if (!convert || !sink) return src;

    const pipeline = new Gst.Pipeline();
    pipeline.add(src);
    pipeline.add(convert);
    pipeline.add(sink);
    src.link(convert);
    convert.link(sink);

    let ret = pipeline.set_state(Gst.State.PLAYING);
    if (ret !== Gst.StateChangeReturn.FAILURE) {
        ret = pipeline.get_state(_SOURCE_PROBE_TIMEOUT_MS * Number(Gst.MSECOND))[0];
    }

    // Tear the probe down and hand the element back unparented, ready for the
    // caller's own pipeline.
    pipeline.set_state(Gst.State.NULL);
    src.unlink(convert);
    pipeline.remove(src);

    return ret === Gst.StateChangeReturn.FAILURE ? null : src;
}

/**
 * Winning factory name per kind — the probe runs ONCE PER PROCESS, not once per
 * `getUserMedia()` call.
 *
 * Not an optimisation. Starting a capture pipeline LEAKS on a host whose audio
 * stack cannot serve it, and the leak is the GStreamer/backend teardown path,
 * not ours to close. Measured in `ghcr.io/gjsify/ci-fedora:44`, ten probes
 * each: `pulsesrc` +10 threads / +728 MB VmSize, `autoaudiosrc` (which resolves
 * to `openalsrc` there) +12 threads / +878 MB. Probing on every call put that
 * on a multiplier — one webrtc suite makes eleven `getUserMedia({audio:true})`
 * calls and finished at 38 threads / 4.29 GB, and a 125-iteration loop wedged
 * the process outright at 409 threads / 15.9 GB, main thread parked in
 * `futex_do_wait`. That is what took `Test 4/4 Fedora 44` from a 7-second suite
 * to a 90-minute job timeout with no output after the last passing test — a
 * hang far worse than the dead-source bug the probe exists to fix.
 *
 * Sampling once bounds the whole cost at one probe for the life of the process.
 * The trade it makes is explicit: the set of capture devices is read at first
 * use, so a microphone plugged in later is not picked up until restart. Fresh
 * ELEMENTS are still made per call — only the VERDICT is remembered.
 */
const _sourceChoice = new Map<string, string>();

/** Resolve the factory to use for `kind`, probing only on the first call. */
function _chooseSource(kind: string, candidates: string[], converter: string, fallback: string): Gst.Element {
    const cached = _sourceChoice.get(kind);
    if (cached) return Gst.ElementFactory.make(cached, null)!;

    for (const name of candidates) {
        const el = _probeSource(name, converter);
        if (el) {
            _sourceChoice.set(kind, name);
            return el;
        }
    }
    _sourceChoice.set(kind, fallback);
    return Gst.ElementFactory.make(fallback, null)!;
}

function _createAudioSource(): Gst.Element {
    // Real sources in priority order — each one OPENED, not just made.
    const el = _chooseSource('audio', ['pipewiresrc', 'pulsesrc', 'autoaudiosrc'], 'audioconvert', 'audiotestsrc');
    try {
        (el as _GstElementProps).is_live = true;
    } catch {
        /* not all sources have is-live */
    }
    if (_sourceChoice.get('audio') === 'audiotestsrc') {
        (el as _GstElementProps).wave = 0; // sine — audible for debugging
    }
    return el;
}

function _createVideoSource(): Gst.Element {
    const el = _chooseSource('video', ['pipewiresrc', 'v4l2src', 'autovideosrc'], 'videoconvert', 'videotestsrc');
    if (_sourceChoice.get('video') === 'videotestsrc') {
        (el as _GstElementProps).is_live = true;
        (el as _GstElementProps).pattern = 0; // SMPTE bars
    }
    return el;
}
