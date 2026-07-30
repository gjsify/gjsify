// GStreamer playback pipeline: AudioBuffer PCM → audio output
//
// Pipeline: appsrc(F32LE) → audioconvert → volume → autoaudiosink
// Each GstPlayer instance is single-use (matches W3C AudioBufferSourceNode).
//
// Reference: GStreamer 1.0 via gi://Gst

import GLib from 'gi://GLib?version=2.0';
import { ensureGstInit, Gst } from './gst-init.js';
import { stopPipeline, trackPipeline } from './gst-teardown.js';
import type { AudioBuffer } from './audio-buffer.js';
import type Gst1 from '@girs/gst-1.0';
import type GstApp1 from '@girs/gstapp-1.0';

// The GstApp typelib is loaded by ensureGstInit() — see gst-init.ts for why a
// bare `import`/`void` does not do it on the node-gi reverse bridge.

export interface GstPlayerOptions {
    audioBuffer: AudioBuffer;
    volume: number;
    loop: boolean;
    offset: number; // start offset in seconds
    duration?: number; // play duration in seconds (undefined = full)
    playbackRate: number;
    onEnded: () => void;
}

/**
 * Manages a single GStreamer playback pipeline for one AudioBufferSourceNode.start() call.
 */
export class GstPlayer {
    private _pipeline: Gst1.Pipeline | null = null;
    private _volumeElement: Gst1.Element | null = null;
    private _busWatchId: number | null = null;
    private _ended = false;
    private _loop: boolean;
    private _onEnded: () => void;
    private _audioBuffer: AudioBuffer;

    constructor(options: GstPlayerOptions) {
        ensureGstInit();
        this._loop = options.loop;
        this._onEnded = options.onEnded;
        this._audioBuffer = options.audioBuffer;

        const { audioBuffer, volume, offset, duration, playbackRate } = options;
        const sr = audioBuffer.sampleRate;
        const ch = audioBuffer.numberOfChannels;

        // Build interleaved PCM data
        const pcmData = this._interleave(audioBuffer, offset, duration);
        if (pcmData.length === 0) {
            // Empty buffer — fire ended immediately
            this._fireEnded();
            return;
        }

        // Build pipeline — format=3 (TIME) ensures downstream gets TIME-based
        // segments, preventing gst_segment_to_stream_time assertion failures.
        const capsStr = `audio/x-raw,format=F32LE,rate=${sr},channels=${ch},layout=interleaved`;
        const desc = `appsrc name=src caps="${capsStr}" format=3 ! audioconvert ! volume name=vol ! autoaudiosink`;
        this._pipeline = Gst.parse_launch(desc) as Gst1.Pipeline;
        trackPipeline(this._pipeline);
        this._volumeElement = this._pipeline.get_by_name('vol');
        const appsrc = this._pipeline.get_by_name('src')! as GstApp1.AppSrc;

        // Set volume
        this._volumeElement.set_property('volume', Math.max(0, Math.min(volume, 10)));

        // Set up bus watch for EOS/ERROR
        const bus = this._pipeline.get_bus();
        this._busWatchId = bus.add_watch(0, (_bus: Gst1.Bus, msg: Gst1.Message) => {
            if (msg.type === Gst.MessageType.EOS) {
                if (this._loop && !this._ended) {
                    // Restart: push data again
                    this._restartPlayback(appsrc, pcmData);
                } else {
                    this._fireEnded();
                }
            } else if (msg.type === Gst.MessageType.ERROR) {
                this._fireEnded();
            }
            return true; // keep watching
        });

        // Push PCM data with proper timestamps for TIME-format segments
        const gstBuf = Gst.Buffer.new_wrapped(pcmData);
        const totalFrames = pcmData.length / (4 * ch);
        gstBuf.pts = 0;
        gstBuf.duration = Math.floor((totalFrames / sr) * Number(Gst.SECOND));
        appsrc.push_buffer(gstBuf);
        appsrc.end_of_stream();

        // Apply playback rate if not 1.0
        if (playbackRate !== 1.0) {
            this._pipeline.set_state(Gst.State.PAUSED);
            // Seek with rate change
            this._pipeline.seek(
                playbackRate,
                Gst.Format.TIME,
                Gst.SeekFlags.FLUSH | Gst.SeekFlags.ACCURATE,
                Gst.SeekType.SET,
                0,
                Gst.SeekType.NONE,
                -1,
            );
        }

        this._pipeline.set_state(Gst.State.PLAYING);
    }

    /** Update volume on a running pipeline */
    setVolume(value: number): void {
        if (this._volumeElement && !this._ended) {
            this._volumeElement.set_property('volume', Math.max(0, Math.min(value, 10)));
        }
    }

    /** Update loop flag */
    setLoop(value: boolean): void {
        this._loop = value;
    }

    /** Stop playback and clean up */
    stop(): void {
        if (this._ended) return;
        this._fireEnded();
    }

    /** Whether playback has ended */
    get ended(): boolean {
        return this._ended;
    }

    private _restartPlayback(_appsrc: GstApp1.AppSrc, _pcmData: Uint8Array): void {
        // For looping: seek pipeline to start
        if (this._pipeline) {
            this._pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH, 0);
        }
    }

    private _fireEnded(): void {
        if (this._ended) return;
        this._ended = true;
        this._cleanup();
        this._onEnded();
    }

    private _cleanup(): void {
        const pipeline = this._pipeline;
        this._pipeline = null;
        this._volumeElement = null;
        this._busWatchId = null;

        if (pipeline) {
            // Defer NULL-state transition to a low-priority idle so this method does not
            // block the GLib main loop when called from within the bus-watch callback (EOS/ERROR).
            // autoaudiosink teardown flushes the audio device, which can take several ms and
            // causes frame drops when SFX fire frequently during gameplay.
            //
            // The pipeline stays REGISTERED until that idle actually runs, so an
            // app that quits first still gets it to NULL via the shutdown drain
            // (`gst-teardown.ts`) instead of finalizing it in PLAYING and
            // printing a GStreamer-CRITICAL per element.
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                stopPipeline(pipeline);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Interleave AudioBuffer's per-channel Float32Arrays into a single Uint8Array.
     * Applies offset (seconds) and optional duration (seconds).
     */
    private _interleave(buf: AudioBuffer, offsetSec: number, durationSec?: number): Uint8Array {
        const ch = buf.numberOfChannels;
        const startFrame = Math.min(Math.floor(offsetSec * buf.sampleRate), buf.length);
        const maxFrames = buf.length - startFrame;
        const frames =
            durationSec !== undefined ? Math.min(Math.floor(durationSec * buf.sampleRate), maxFrames) : maxFrames;

        if (frames <= 0) return new Uint8Array(0);

        const interleaved = new Float32Array(frames * ch);
        for (let frame = 0; frame < frames; frame++) {
            for (let c = 0; c < ch; c++) {
                interleaved[frame * ch + c] = buf._channelData[c][startFrame + frame];
            }
        }

        return new Uint8Array(interleaved.buffer);
    }
}
