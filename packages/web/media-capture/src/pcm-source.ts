// A mono PCM audio source for speech recognition (ADR 0127 decision 9):
// the capture chain's microphone, converted and resampled to a fixed format
// and pulled out of an appsink.
//
// The appsink is POLLED, never driven by its `new-sample` signal: that signal
// fires on GStreamer's streaming thread, and GJS refuses to run JS there.

import GLib from 'gi://GLib?version=2.0';
import GstApp from 'gi://GstApp?version=1.0';
import { Gst, ensureGstInit } from './gst-init.js';
import { createAudioSource, isTestSource } from './capture-source.js';

export type PcmFormat = 'S16LE' | 'F32LE';

export interface PcmSourceOptions {
    /** Samples per second. Default 16000, what the recognition engines take. */
    sampleRate?: number;
    /** Sample format. Default `S16LE`. */
    format?: PcmFormat;
    /** A device id as `enumerateDevices()` reports it. Default: the host's default input. */
    deviceId?: string;
    /** Use this element instead of the capture chain — a file, a test tone, a fake. */
    source?: Gst.Element;
    /** How often an empty appsink is polled, in ms. Default 10. */
    pollIntervalMs?: number;
}

export interface PcmSource extends AsyncIterable<Uint8Array> {
    readonly sampleRate: number;
    readonly format: PcmFormat;
    readonly channels: 1;
    /** Factory name of the source element, e.g. `pipewiresrc`. */
    readonly label: string;
    /** True when no capture device opened and a test tone stands in. */
    readonly synthetic: boolean;
    /** Start the pipeline. Idempotent; `read()` calls it. Throws if the source cannot start. */
    start(): void;
    /** The next chunk of interleaved little-endian samples, or `null` at end of stream. Rejects on a pipeline error. */
    read(): Promise<Uint8Array | null>;
    /** Stop and release the pipeline. Idempotent; a pending `read()` resolves `null`. */
    stop(): void;
}

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_POLL_MS = 10;
/** Bounds the queue behind a reader that is slower than the source. */
const MAX_QUEUED_BUFFERS = 200;

interface AppSinkProps extends Gst.Element {
    emit_signals?: boolean;
    sync?: boolean;
    max_buffers?: number;
    caps?: Gst.Caps;
}

/**
 * Make sure the GstApp typelib is LOADED, not merely imported: `appsink`'s
 * `try_pull_sample` only resolves once the namespace is registered, and on the
 * node target an import used for its side effect alone is shaken away. An
 * access inside a called function is honoured on both (same as
 * `@gjsify/webaudio`).
 */
function ensureGstAppLoaded(): void {
    if (GstApp.AppSink === undefined) {
        throw new Error('GstApp typelib is unavailable — install gstreamer1-plugins-base (gst-plugins-base)');
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Open a mono PCM source: `source ! audioconvert ! audioresample ! capsfilter ! appsink`.
 * The pipeline is built but not started.
 */
export function openPcmSource(options: PcmSourceOptions = {}): PcmSource {
    ensureGstInit();
    ensureGstAppLoaded();
    const sampleRate = Math.trunc(options.sampleRate ?? DEFAULT_SAMPLE_RATE);
    const format = options.format ?? 'S16LE';
    const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    if (!(sampleRate > 0)) throw new RangeError(`openPcmSource: invalid sampleRate ${options.sampleRate}`);
    if (format !== 'S16LE' && format !== 'F32LE') throw new TypeError(`openPcmSource: unsupported format ${format}`);

    const source = options.source ?? createAudioSource({ deviceId: options.deviceId });
    const convert = Gst.ElementFactory.make('audioconvert', null);
    const resample = Gst.ElementFactory.make('audioresample', null);
    const capsfilter = Gst.ElementFactory.make('capsfilter', null);
    const sink = Gst.ElementFactory.make('appsink', null);
    if (!convert || !resample || !capsfilter || !sink) {
        throw new Error(
            'openPcmSource: GStreamer audioconvert, audioresample or appsink is missing (gst-plugins-base)',
        );
    }

    (capsfilter as AppSinkProps).caps = Gst.Caps.from_string(
        `audio/x-raw,format=${format},rate=${sampleRate},channels=1,layout=interleaved`,
    );
    const appsink = sink as AppSinkProps & Gst.Element;
    appsink.emit_signals = false;
    // Not a clock-paced sink: a file or test source finishes as fast as it is read,
    // and a live source is already paced by its device.
    appsink.sync = false;
    appsink.max_buffers = MAX_QUEUED_BUFFERS;
    // `drop` stays at its default (false): a reader that falls behind blocks the source, it never loses audio.

    const pipeline = new Gst.Pipeline();
    const chain = [source, convert, resample, capsfilter, sink];
    for (const el of chain) pipeline.add(el);
    for (let i = 0; i < chain.length - 1; i++) {
        if (!chain[i].link(chain[i + 1])) {
            throw new Error(`openPcmSource: cannot link ${chain[i].name} to ${chain[i + 1].name}`);
        }
    }

    const bus = pipeline.get_bus()!;
    const appSink = sink as unknown as Gst.Element & {
        try_pull_sample(timeout: number): Gst.Sample | null;
        is_eos(): boolean;
    };
    let started = false;
    let stopped = false;

    const failIfBusError = (): void => {
        const msg = bus.pop_filtered(Gst.MessageType.ERROR);
        if (!msg) return;
        const [err, debug] = msg.parse_error();
        throw new Error(`openPcmSource: ${err.message}${debug ? ` (${debug})` : ''}`);
    };

    const pcm: PcmSource = {
        sampleRate,
        format,
        channels: 1,
        label: source.get_factory()?.get_name() ?? source.name,
        synthetic: isTestSource(source),

        start() {
            if (started || stopped) return;
            started = true;
            const ret = pipeline.set_state(Gst.State.PLAYING);
            if (ret === Gst.StateChangeReturn.FAILURE) {
                failIfBusError();
                throw new Error(`openPcmSource: ${pcm.label} failed to start`);
            }
        },

        async read() {
            pcm.start();
            while (!stopped) {
                // An error message outranks any sample still queued: bytes from a dead pipeline are not audio.
                failIfBusError();
                const sample = appSink.try_pull_sample(0);
                if (sample) {
                    const buffer = sample.get_buffer();
                    if (buffer) {
                        const [ok, info] = buffer.map(Gst.MapFlags.READ);
                        if (ok) {
                            const chunk = new Uint8Array(info.data);
                            buffer.unmap(info);
                            if (chunk.length > 0) return chunk;
                        }
                    }
                    continue;
                }
                if (appSink.is_eos()) return null;
                await sleep(pollMs);
            }
            return null;
        },

        stop() {
            if (stopped) return;
            stopped = true;
            pipeline.set_state(Gst.State.NULL);
        },

        async *[Symbol.asyncIterator]() {
            try {
                for (let chunk = await pcm.read(); chunk; chunk = await pcm.read()) yield chunk;
            } finally {
                pcm.stop();
            }
        },
    };
    return pcm;
}
