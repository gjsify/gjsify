// AudioContext and Audio stubs for GJS — the Web Audio API is not available
// in GJS/GNOME. These stubs prevent crashes in libraries that check for the
// existence of AudioContext (e.g. Excalibur.js). All audio playback is
// silently discarded. Future work: implement via GStreamer.
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext

/** Minimal AudioNode stub. */
class AudioNode {
    connect(_dest: AudioNode): AudioNode { return _dest; }
    disconnect(): void {}
}

/** Minimal GainNode stub. */
class GainNode extends AudioNode {
    gain = { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} };
}

/** Minimal AudioBufferSourceNode stub. */
class AudioBufferSourceNode extends AudioNode {
    buffer: any = null;
    loop = false;
    loopStart = 0;
    loopEnd = 0;
    playbackRate = { value: 1, setValueAtTime: () => {} };
    onended: (() => void) | null = null;
    start(_when?: number, _offset?: number, _duration?: number): void {}
    stop(_when?: number): void {}
}

/** Minimal AudioBuffer stub. */
class AudioBuffer {
    readonly sampleRate: number;
    readonly length: number;
    readonly duration: number;
    readonly numberOfChannels: number;
    constructor(options: { sampleRate?: number; length?: number; numberOfChannels?: number } = {}) {
        this.sampleRate = options.sampleRate ?? 44100;
        this.length = options.length ?? 0;
        this.numberOfChannels = options.numberOfChannels ?? 2;
        this.duration = this.length / this.sampleRate;
    }
    getChannelData(_channel: number): Float32Array { return new Float32Array(this.length); }
    copyFromChannel(_dest: Float32Array, _channel: number, _offset?: number): void {}
    copyToChannel(_src: Float32Array, _channel: number, _offset?: number): void {}
}

/** Stub AudioContext — all API calls are no-ops. */
export class AudioContext {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    sampleRate = 44100;
    destination = new AudioNode();
    listener = {};

    createGain(): GainNode { return new GainNode(); }
    createBufferSource(): AudioBufferSourceNode { return new AudioBufferSourceNode(); }
    createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
        return new AudioBuffer({ numberOfChannels: channels, length, sampleRate });
    }
    createAnalyser(): any { return { connect: () => {}, fftSize: 2048, frequencyBinCount: 1024, getByteFrequencyData: () => {}, getFloatFrequencyData: () => {} }; }
    createDynamicsCompressor(): AudioNode { return new AudioNode(); }
    createBiquadFilter(): any { return new AudioNode(); }
    createConvolver(): AudioNode { return new AudioNode(); }
    createPanner(): AudioNode { return new AudioNode(); }
    createStereoPanner(): AudioNode { return new AudioNode(); }

    decodeAudioData(_buffer: ArrayBuffer, onsuccess?: (buf: AudioBuffer) => void, onerror?: (err: Error) => void): Promise<AudioBuffer> {
        const err = new Error('AudioContext: Web Audio API not available in GJS');
        if (typeof onerror === 'function') onerror(err);
        return Promise.reject(err);
    }

    resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
    suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
    close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }

    addEventListener(_type: string, _listener: any): void {}
    removeEventListener(_type: string, _listener: any): void {}
}

/** HTMLAudioElement stub — used by Excalibur for audio format detection. */
export class HTMLAudioElement {
    src = '';
    volume = 1;
    loop = false;
    paused = true;
    currentTime = 0;
    duration = 0;
    readyState = 0;

    canPlayType(_type: string): CanPlayTypeResult { return ''; }
    play(): Promise<void> { return Promise.resolve(); }
    pause(): void {}
    load(): void {}
    addEventListener(_type: string, _listener: any): void {}
    removeEventListener(_type: string, _listener: any): void {}
}
