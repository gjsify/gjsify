// AudioContext — top-level Web Audio API entry point backed by GStreamer.
//
// Phase 1: covers Excalibur.js needs (decodeAudioData, createBufferSource,
// createGain, currentTime, resume/suspend/close).
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext

import GLib from 'gi://GLib?version=2.0';
import { ensureGstInit } from './gst-init.js';
import { AudioBuffer } from './audio-buffer.js';
import { AudioNode } from './audio-node.js';
import { AudioDestinationNode } from './audio-destination-node.js';
import { AudioBufferSourceNode } from './audio-buffer-source-node.js';
import { GainNode } from './gain-node.js';
import { decodeAudioDataSync } from './gst-decoder.js';

export class AudioContext {
    state: AudioContextState = 'suspended';
    readonly sampleRate = 44100;
    readonly destination: AudioDestinationNode;
    readonly listener = {};

    private _startTime: number;

    constructor() {
        ensureGstInit();
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
        errorCallback?: (error: DOMException) => void
    ): Promise<AudioBuffer> {
        try {
            const buffer = decodeAudioDataSync(arrayBuffer);
            successCallback?.(buffer);
            return Promise.resolve(buffer);
        } catch (err) {
            const domErr = err instanceof DOMException
                ? err
                : new DOMException('Unable to decode audio data', 'EncodingError');
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
    }

    // Stub methods for APIs not yet backed by GStreamer (Phase 3)
    createAnalyser(): any {
        return {
            connect: () => {},
            disconnect: () => {},
            fftSize: 2048,
            frequencyBinCount: 1024,
            getByteFrequencyData: () => {},
            getFloatFrequencyData: () => {},
        };
    }

    createDynamicsCompressor(): AudioNode { return new AudioNode(); }
    createBiquadFilter(): any { return new AudioNode(); }
    createConvolver(): AudioNode { return new AudioNode(); }
    createPanner(): AudioNode { return new AudioNode(); }
    createStereoPanner(): AudioNode { return new AudioNode(); }

    addEventListener(_type: string, _listener: any): void {}
    removeEventListener(_type: string, _listener: any): void {}
}
