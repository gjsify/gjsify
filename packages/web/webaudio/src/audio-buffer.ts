// AudioBuffer — holds decoded PCM audio data as per-channel Float32Arrays.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer

export interface AudioBufferOptions {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
}

export class AudioBuffer {
    readonly sampleRate: number;
    readonly length: number;
    readonly duration: number;
    readonly numberOfChannels: number;
    /** @internal */
    _channelData: Float32Array[];

    constructor(options: AudioBufferOptions) {
        this.sampleRate = options.sampleRate;
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels;
        this.duration = this.length / this.sampleRate;
        this._channelData = [];
        for (let i = 0; i < this.numberOfChannels; i++) {
            this._channelData.push(new Float32Array(this.length));
        }
    }

    getChannelData(channel: number): Float32Array {
        if (channel < 0 || channel >= this.numberOfChannels) {
            throw new RangeError(`channel index ${channel} out of range [0, ${this.numberOfChannels})`);
        }
        return this._channelData[channel];
    }

    copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset = 0): void {
        const src = this.getChannelData(channelNumber);
        const len = Math.min(destination.length, src.length - bufferOffset);
        destination.set(src.subarray(bufferOffset, bufferOffset + len));
    }

    copyToChannel(source: Float32Array, channelNumber: number, bufferOffset = 0): void {
        const dest = this.getChannelData(channelNumber);
        const len = Math.min(source.length, dest.length - bufferOffset);
        dest.set(source.subarray(0, len), bufferOffset);
    }
}
