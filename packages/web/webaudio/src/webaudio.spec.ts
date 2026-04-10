// Web Audio API tests — GJS only (requires GStreamer)
//
// Ported from W3C Web Audio API spec behavior.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

import { describe, it, expect } from '@gjsify/unit';
import { AudioContext } from './audio-context.js';
import { AudioBuffer } from './audio-buffer.js';
import { AudioParam } from './audio-param.js';
import { AudioNode } from './audio-node.js';
import { GainNode } from './gain-node.js';
import { AudioBufferSourceNode } from './audio-buffer-source-node.js';
import { AudioDestinationNode } from './audio-destination-node.js';
import { HTMLAudioElement } from './html-audio-element.js';

/** Generate a minimal WAV ArrayBuffer (mono, 16-bit PCM, 440Hz sine) */
function createTestWav(durationSec = 0.1, sampleRate = 44100): ArrayBuffer {
    const numSamples = Math.floor(durationSec * sampleRate);
    const bitsPerSample = 16;
    const numChannels = 1;
    const dataSize = numSamples * numChannels * (bitsPerSample / 8);
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
    view.setUint16(32, numChannels * bitsPerSample / 8, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < numSamples; i++) {
        const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate);
        view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
    }
    return buf;
}

export default async () => {
    await describe('AudioContext', async () => {
        await it('should start in suspended state', async () => {
            const ctx = new AudioContext();
            expect(ctx.state).toBe('suspended');
        });

        await it('should transition to running on resume', async () => {
            const ctx = new AudioContext();
            await ctx.resume();
            expect(ctx.state).toBe('running');
        });

        await it('should transition to suspended on suspend', async () => {
            const ctx = new AudioContext();
            await ctx.resume();
            await ctx.suspend();
            expect(ctx.state).toBe('suspended');
        });

        await it('should transition to closed on close', async () => {
            const ctx = new AudioContext();
            await ctx.close();
            expect(ctx.state).toBe('closed');
        });

        await it('should have sampleRate of 44100', async () => {
            const ctx = new AudioContext();
            expect(ctx.sampleRate).toBe(44100);
        });

        await it('should have a destination node', async () => {
            const ctx = new AudioContext();
            expect(ctx.destination).toBeDefined();
            expect(ctx.destination instanceof AudioDestinationNode).toBe(true);
        });
    });

    await describe('AudioContext.currentTime', async () => {
        await it('should be a number >= 0', async () => {
            const ctx = new AudioContext();
            expect(typeof ctx.currentTime).toBe('number');
            expect(ctx.currentTime >= 0).toBe(true);
        });

        await it('should increase monotonically', async () => {
            const ctx = new AudioContext();
            const t1 = ctx.currentTime;
            // Small busy-wait to ensure time passes
            const start = Date.now();
            while (Date.now() - start < 5) { /* busy wait */ }
            const t2 = ctx.currentTime;
            expect(t2 > t1).toBe(true);
        });
    });

    await describe('AudioContext.createBuffer', async () => {
        await it('should create a buffer with correct properties', async () => {
            const ctx = new AudioContext();
            const buf = ctx.createBuffer(2, 44100, 44100);
            expect(buf.numberOfChannels).toBe(2);
            expect(buf.length).toBe(44100);
            expect(buf.sampleRate).toBe(44100);
            expect(buf.duration).toBe(1);
        });
    });

    await describe('AudioBuffer', async () => {
        await it('should return Float32Array from getChannelData', async () => {
            const buf = new AudioBuffer({ numberOfChannels: 2, length: 100, sampleRate: 44100 });
            const ch0 = buf.getChannelData(0);
            expect(ch0 instanceof Float32Array).toBe(true);
            expect(ch0.length).toBe(100);
        });

        await it('should throw on invalid channel index', async () => {
            const buf = new AudioBuffer({ numberOfChannels: 1, length: 10, sampleRate: 44100 });
            expect(() => buf.getChannelData(1)).toThrow();
        });

        await it('should support copyFromChannel/copyToChannel round-trip', async () => {
            const buf = new AudioBuffer({ numberOfChannels: 1, length: 4, sampleRate: 44100 });
            const src = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            buf.copyToChannel(src, 0);
            const dst = new Float32Array(4);
            buf.copyFromChannel(dst, 0);
            expect(dst[0]).toBe(src[0]);
            expect(dst[3]).toBe(src[3]);
        });

        await it('should calculate duration correctly', async () => {
            const buf = new AudioBuffer({ numberOfChannels: 1, length: 22050, sampleRate: 44100 });
            expect(buf.duration).toBe(0.5);
        });
    });

    await describe('AudioContext.decodeAudioData', async () => {
        await it('should decode a WAV file', async () => {
            const ctx = new AudioContext();
            const wav = createTestWav(0.1, 44100);
            const buf = await ctx.decodeAudioData(wav);
            expect(buf instanceof AudioBuffer).toBe(true);
            expect(buf.sampleRate).toBe(44100);
            expect(buf.numberOfChannels).toBe(1);
            // Duration should be approximately 0.1s (allow some tolerance for decoder)
            expect(buf.duration > 0.09).toBe(true);
            expect(buf.duration < 0.15).toBe(true);
        });

        await it('should produce non-zero PCM data', async () => {
            const ctx = new AudioContext();
            const wav = createTestWav(0.1, 44100);
            const buf = await ctx.decodeAudioData(wav);
            const data = buf.getChannelData(0);
            let nonZero = 0;
            for (let i = 0; i < data.length; i++) {
                if (data[i] !== 0) nonZero++;
            }
            expect(nonZero > data.length * 0.9).toBe(true);
        });

        await it('should call success callback', async () => {
            const ctx = new AudioContext();
            const wav = createTestWav(0.05);
            let callbackResult: AudioBuffer | null = null;
            await ctx.decodeAudioData(wav, (buf) => { callbackResult = buf; });
            expect(callbackResult).toBeDefined();
            expect(callbackResult!.numberOfChannels).toBe(1);
        });

        await it('should reject invalid data', async () => {
            const ctx = new AudioContext();
            const invalid = new ArrayBuffer(10);
            let rejected = false;
            try {
                await ctx.decodeAudioData(invalid);
            } catch {
                rejected = true;
            }
            expect(rejected).toBe(true);
        });
    });

    await describe('AudioNode', async () => {
        await it('should connect and disconnect', async () => {
            const a = new AudioNode();
            const b = new AudioNode();
            a.connect(b);
            expect(a._outputs.has(b)).toBe(true);
            expect(b._inputs.has(a)).toBe(true);
            a.disconnect(b);
            expect(a._outputs.has(b)).toBe(false);
            expect(b._inputs.has(a)).toBe(false);
        });

        await it('should return destination from connect()', async () => {
            const a = new AudioNode();
            const b = new AudioNode();
            const result = a.connect(b);
            expect(result).toBe(b);
        });

        await it('should disconnect all on disconnect()', async () => {
            const a = new AudioNode();
            const b = new AudioNode();
            const c = new AudioNode();
            a.connect(b);
            a.connect(c);
            a.disconnect();
            expect(a._outputs.size).toBe(0);
        });
    });

    await describe('GainNode', async () => {
        await it('should have gain AudioParam with default 1', async () => {
            const gain = new GainNode();
            expect(gain.gain instanceof AudioParam).toBe(true);
            expect(gain.gain.value).toBe(1);
        });

        await it('should allow setting gain value', async () => {
            const gain = new GainNode();
            gain.gain.value = 0.5;
            expect(gain.gain.value).toBe(0.5);
        });
    });

    await describe('AudioParam', async () => {
        await it('should have correct default value', async () => {
            const param = new AudioParam(0.75);
            expect(param.value).toBe(0.75);
            expect(param.defaultValue).toBe(0.75);
        });

        await it('should clamp to min/max', async () => {
            const param = new AudioParam(0, 0, 1);
            param.value = 2;
            expect(param.value).toBe(1);
            param.value = -1;
            expect(param.value).toBe(0);
        });

        await it('should call onChange callback', async () => {
            const param = new AudioParam(0);
            let called = false;
            param._onChange = () => { called = true; };
            param.value = 0.5;
            expect(called).toBe(true);
        });
    });

    await describe('AudioBufferSourceNode', async () => {
        await it('should have default properties', async () => {
            const node = new AudioBufferSourceNode();
            expect(node.buffer).toBeNull();
            expect(node.loop).toBe(false);
            expect(node.playbackRate.value).toBe(1);
        });

        await it('should throw if started twice', async () => {
            const node = new AudioBufferSourceNode();
            node.buffer = new AudioBuffer({ numberOfChannels: 1, length: 100, sampleRate: 44100 });
            const gain = new GainNode();
            const dest = new AudioDestinationNode();
            node.connect(gain).connect(dest);
            node.start();
            expect(() => node.start()).toThrow();
        });
    });

    await describe('HTMLAudioElement', async () => {
        await it('should return maybe for supported types', async () => {
            const audio = new HTMLAudioElement();
            expect(audio.canPlayType('audio/mpeg')).toBe('maybe');
            expect(audio.canPlayType('audio/wav')).toBe('maybe');
            expect(audio.canPlayType('audio/ogg')).toBe('maybe');
        });

        await it('should return empty for unsupported types', async () => {
            const audio = new HTMLAudioElement();
            expect(audio.canPlayType('audio/unknown')).toBe('');
            expect(audio.canPlayType('video/mp4')).toBe('');
        });

        await it('should handle codecs parameter', async () => {
            const audio = new HTMLAudioElement();
            expect(audio.canPlayType('audio/ogg; codecs=vorbis')).toBe('maybe');
        });
    });
};
