// The GStreamer capture chain: pick a source that actually opens
// (pipewiresrc / pulsesrc / v4l2src, then autoaudiosrc / autovideosrc, then a
// test source), bind a W3C deviceId to it and express constraints as caps.
//
// Extracted from `@gjsify/webrtc`'s getUserMedia (ADR 0127 decision 9): one
// chain, one place to fix it. `@gjsify/webrtc` builds MediaStreamTracks on it;
// `openPcmSource()` builds a speech-recognition feed on it.

import { Gst, ensureGstInit } from './gst-init.js';

/**
 * Structural shape for GStreamer element GObject-properties we set
 * dynamically (none of these are typed on `Gst.Element` from the GIR
 * bindings; GStreamer exposes them as runtime properties).
 */
interface GstElementProps extends Gst.Element {
    caps?: Gst.Caps;
    is_live?: boolean;
    /** audiotestsrc: 0=sine, 1=square, 2=saw, 3=triangle, ... */
    wave?: number;
    /** videotestsrc: 0=SMPTE bars, 1=snow, ... */
    pattern?: number;
}

export interface CaptureConstraints {
    deviceId?: string;
    sampleRate?: number;
    channelCount?: number;
    width?: number;
    height?: number;
    frameRate?: number;
}

export type CaptureKind = 'audio' | 'video';

/** A capture source inside its own pipeline, constraints applied, not yet started. */
export interface Capture {
    source: Gst.Element;
    pipeline: Gst.Pipeline;
}

/**
 * Open a capture source for `kind` in a fresh pipeline, with the constraints
 * mapped to a capsfilter behind it. The pipeline stays in NULL; the caller
 * decides when to start it.
 */
export function openCapture(kind: CaptureKind, constraints: CaptureConstraints = {}): Capture {
    ensureGstInit();
    const source = kind === 'audio' ? createAudioSource(constraints) : createVideoSource(constraints);
    const pipeline = new Gst.Pipeline();
    pipeline.add(source);

    const capsStr = kind === 'audio' ? buildAudioCaps(constraints) : buildVideoCaps(constraints);
    if (capsStr) {
        const capsfilter = Gst.ElementFactory.make('capsfilter', null)!;
        (capsfilter as GstElementProps).caps = Gst.Caps.from_string(capsStr);
        pipeline.add(capsfilter);
        source.link(capsfilter);
    }
    return { source, pipeline };
}

/** True when `source` is a synthetic test source, i.e. no capture device opened on this host. */
export function isTestSource(source: Gst.Element): boolean {
    const factory = source.get_factory()?.get_name();
    return factory === 'audiotestsrc' || factory === 'videotestsrc';
}

/** Build a GStreamer caps string for audio constraints. */
export function buildAudioCaps(c: CaptureConstraints): string | null {
    const parts: string[] = [];
    if (c.sampleRate != null) parts.push(`rate=${Math.trunc(c.sampleRate)}`);
    if (c.channelCount != null) parts.push(`channels=${Math.trunc(c.channelCount)}`);
    if (parts.length === 0) return null;
    return `audio/x-raw,${parts.join(',')}`;
}

/** Build a GStreamer caps string for video constraints. */
export function buildVideoCaps(c: CaptureConstraints): string | null {
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
const SOURCE_PROBE_TIMEOUT_MS = 500;

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
function probeSource(name: string, converter: string): Gst.Element | null {
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
        ret = pipeline.get_state(SOURCE_PROBE_TIMEOUT_MS * Number(Gst.MSECOND))[0];
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
const sourceChoice = new Map<string, string>();

/** Resolve the factory to use for `kind`, probing only on the first call. */
function chooseSource(kind: string, candidates: string[], converter: string, fallback: string): Gst.Element {
    const cached = sourceChoice.get(kind);
    if (cached) return Gst.ElementFactory.make(cached, null)!;

    for (const name of candidates) {
        const el = probeSource(name, converter);
        if (el) {
            sourceChoice.set(kind, name);
            return el;
        }
    }
    sourceChoice.set(kind, fallback);
    return Gst.ElementFactory.make(fallback, null)!;
}

/**
 * Property names a capture source may spell its device under. There is no
 * single one, and writing the wrong name fails in the worst available way:
 * GJS installs a GObject property as a prototype accessor, so assigning a name
 * the element does not declare does NOT raise — it creates a dead JS
 * own-property and the constraint is dropped with the process still healthy.
 *
 * Measured per element, `'device' in element` after `Gst.ElementFactory.make`:
 * `pulsesrc`, `v4l2src` and `alsasrc` declare `device`; `pipewiresrc` — the
 * FIRST candidate of both chains — declares `target-object` and `path`, not
 * `device`;
 * `autoaudiosrc`, `autovideosrc`, `audiotestsrc` and `videotestsrc` declare
 * neither. So the untyped `device` write this replaced was inert on five of the
 * eight, and inert on ALL of them in `ghcr.io/gjsify/ci-fedora:44`, where
 * `pipewiresrc` is absent and the audio chain lands on `audiotestsrc`.
 *
 * On `pipewiresrc`, `target-object` comes before `path`: `path` is deprecated
 * and takes a node id, while `target-object` takes a node name or serial, and
 * `enumerateDevices()` reports `node.name` as the `deviceId`.
 *
 * `'prop' in el` is the existence test because `find_property` is not reachable
 * from JS: `GObject.Object.prototype.find_property` is `undefined` under GJS.
 */
const DEVICE_PROPS = ['device', 'target_object', 'path'] as const;

/** Kinds already reported as unable to carry a `deviceId` — once per process. */
const unboundDevice = new Set<string>();

/**
 * Bind a W3C `deviceId` to a source element, reporting when the element cannot
 * express one. A caller that asked for a specific device and silently receives
 * another is the defect #1513 reports, so the unbindable case is never quiet.
 */
export function bindDevice(kind: string, el: Gst.Element, deviceId: string | undefined): void {
    if (!deviceId) return;
    for (const prop of DEVICE_PROPS) {
        if (!(prop in el)) continue;
        (el as unknown as Record<string, string>)[prop] = deviceId;
        return;
    }
    if (unboundDevice.has(kind)) return;
    unboundDevice.add(kind);
    console.warn(
        `getUserMedia: deviceId ${JSON.stringify(deviceId)} ignored — ${el.name} has no device property, ` +
            `so the ${kind} source is the host default. getSupportedConstraints() reports deviceId: true.`,
    );
}

export function createAudioSource(constraints: CaptureConstraints = {}): Gst.Element {
    // Real sources in priority order — each one OPENED, not just made.
    const el = chooseSource('audio', ['pipewiresrc', 'pulsesrc', 'autoaudiosrc'], 'audioconvert', 'audiotestsrc');
    try {
        (el as GstElementProps).is_live = true;
    } catch {
        /* not all sources have is-live */
    }
    if (sourceChoice.get('audio') === 'audiotestsrc') {
        (el as GstElementProps).wave = 0; // sine — audible for debugging
    }
    bindDevice('audio', el, constraints.deviceId);
    return el;
}

export function createVideoSource(constraints: CaptureConstraints = {}): Gst.Element {
    const el = chooseSource('video', ['pipewiresrc', 'v4l2src', 'autovideosrc'], 'videoconvert', 'videotestsrc');
    if (sourceChoice.get('video') === 'videotestsrc') {
        (el as GstElementProps).is_live = true;
        (el as GstElementProps).pattern = 0; // SMPTE bars
    }
    bindDevice('video', el, constraints.deviceId);
    return el;
}
