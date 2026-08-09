// AudioContext — top-level Web Audio API entry point backed by GStreamer.
//
// Phase 1: covers Excalibur.js needs (decodeAudioData, createBufferSource,
// createGain, currentTime, resume/suspend/close).
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext

import GLib from 'gi://GLib?version=2.0';
import { tryEnsureGstInit } from './gst-init.js';
import { AudioBuffer } from './audio-buffer.js';
import { AudioNode } from './audio-node.js';
import { AudioDestinationNode } from './audio-destination-node.js';
import { AudioBufferSourceNode } from './audio-buffer-source-node.js';
import { GainNode } from './gain-node.js';
import { decodeAudioDataSync } from './gst-decoder.js';
import { stopAllPipelines } from './gst-teardown.js';

export class AudioContext {
    state: AudioContextState = 'suspended';
    readonly sampleRate = 44100;
    readonly destination: AudioDestinationNode;
    readonly listener = {};

    private _startTime: number;

    /**
     * CONSTRUCTING A CONTEXT IS NOT PLAYING AUDIO, so a missing audio backend
     * may not be fatal here. `ensureGstInit()` threw, and it killed whole
     * applications: on the batteries-included GTK runtime bundles (win32-x64,
     * darwin) GStreamer is not shipped, and Excalibur's boot-time audio unlock
     * constructs a context before the first frame — so `gjsify showcase
     * excalibur-jelly-jumper --runtime node` on Windows died with "Failed to
     * require Gst 1.0: Typelib file for namespace 'Gst' not found" and the game
     * never rendered.
     *
     * In a browser `new AudioContext()` always succeeds; a page that cannot play
     * sound still runs. This matches that. The rule was already written down one
     * level below — `AudioBufferSourceNode.start()` degrades to silent rather
     * than throw, "a single failed audio node must NEVER crash the whole app" —
     * it just had not been applied to the constructor.
     *
     * Warned ONCE per context and not per sound: a game loading forty samples
     * would otherwise bury its own output. Everything downstream already copes —
     * `start()` degrades to silent and `decodeAudioData` rejects with an
     * `EncodingError`, which is what the spec says a failed decode does.
     */
    constructor() {
        const reason = tryEnsureGstInit();
        if (reason !== null) {
            console.warn(
                `[webaudio] AudioContext: GStreamer is unavailable, continuing SILENT — ${reason}\n` +
                    '  Audio needs GStreamer 1.0 with gst-plugins-base. The @gjsify/gtk-runtime-* ' +
                    'bundles do not ship it, so install it system-wide (Fedora: gstreamer1 ' +
                    'gstreamer1-plugins-base; Windows: an MSYS2/gvsbuild GStreamer on PATH).',
            );
        }
        this._startTime = GLib.get_monotonic_time();
        this.destination = new AudioDestinationNode();
    }

    /** Monotonically increasing time in seconds since context creation. */
    get currentTime(): number {
        return (GLib.get_monotonic_time() - this._startTime) / 1_000_000;
    }

    createGain(): GainNode {
        return new GainNode();
    }

    createBufferSource(): AudioBufferSourceNode {
        return new AudioBufferSourceNode();
    }

    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
        return new AudioBuffer({ numberOfChannels, length, sampleRate });
    }

    /**
     * Decode encoded audio data (MP3, WAV, OGG, etc.) into an AudioBuffer.
     * Uses GStreamer's decodebin for format-agnostic decoding.
     */
    decodeAudioData(
        arrayBuffer: ArrayBuffer,
        successCallback?: (buffer: AudioBuffer) => void,
        errorCallback?: (error: DOMException) => void,
    ): Promise<AudioBuffer> {
        try {
            const buffer = decodeAudioDataSync(arrayBuffer);
            successCallback?.(buffer);
            return Promise.resolve(buffer);
        } catch (err) {
            const domErr =
                err instanceof DOMException ? err : new DOMException('Unable to decode audio data', 'EncodingError');
            errorCallback?.(domErr);
            return Promise.reject(domErr);
        }
    }

    async resume(): Promise<void> {
        this.state = 'running';
    }

    async suspend(): Promise<void> {
        this.state = 'suspended';
    }

    async close(): Promise<void> {
        this.state = 'closed';
        // W3C: close() releases the context's system audio resources. Here that
        // is the GStreamer side — bring every pipeline this package still holds
        // to NULL now rather than leaving it to a deferred idle that a quitting
        // app may never reach.
        stopAllPipelines();
    }

    // Stub methods for APIs not yet backed by GStreamer (Phase 3).
    // Returns an `AnalyserNode`-shaped stub — the W3C `AnalyserNode` extends `AudioNode` with
    // `fftSize` / `frequencyBinCount` / `getByteFrequencyData()` / `getFloatFrequencyData()`.
    createAnalyser(): AnalyserNodeStub {
        return {
            connect: () => {},
            disconnect: () => {},
            fftSize: 2048,
            frequencyBinCount: 1024,
            getByteFrequencyData: () => {},
            getFloatFrequencyData: () => {},
        };
    }

    createDynamicsCompressor(): AudioNode {
        return new AudioNode();
    }
    createBiquadFilter(): AudioNode {
        return new AudioNode();
    }
    createConvolver(): AudioNode {
        return new AudioNode();
    }
    createPanner(): AudioNode {
        return new AudioNode();
    }
    createStereoPanner(): AudioNode {
        return new AudioNode();
    }

    addEventListener(_type: string, _listener: ((event: Event) => void) | null): void {}
    removeEventListener(_type: string, _listener: ((event: Event) => void) | null): void {}
}

/** Minimal AnalyserNode stub returned by `createAnalyser()` until GStreamer backing lands. */
interface AnalyserNodeStub {
    connect(): void;
    disconnect(): void;
    fftSize: number;
    frequencyBinCount: number;
    getByteFrequencyData(): void;
    getFloatFrequencyData(): void;
}
