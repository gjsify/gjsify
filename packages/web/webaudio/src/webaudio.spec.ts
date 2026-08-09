// Web Audio API tests — GJS only (requires GStreamer)
//
// Ported from W3C Web Audio API spec behavior.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

import { describe, it, expect } from '@gjsify/unit';
import { decodeAudioDataSync } from './gst-decoder.js';
import { AudioContext } from './audio-context.js';
import { AudioBuffer } from './audio-buffer.js';
import { AudioParam } from './audio-param.js';
import { AudioNode } from './audio-node.js';
import { GainNode } from './gain-node.js';
import { AudioBufferSourceNode } from './audio-buffer-source-node.js';
import { AudioDestinationNode } from './audio-destination-node.js';
import { HTMLAudioElement } from './html-audio-element.js';
import { livePipelineCount, stopAllPipelines } from './gst-teardown.js';
import { primeGstOutcomeForTests, tryEnsureGstInit } from './gst-init.js';

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
    view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
    view.setUint16(32, (numChannels * bitsPerSample) / 8, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < numSamples; i++) {
        const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
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
            while (Date.now() - start < 5) {
                /* busy wait */
            }
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
            await ctx.decodeAudioData(wav, (buf) => {
                callbackResult = buf;
            });
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

    await describe('runtime gating', async () => {
        // GStreamer decode + playback used to be REFUSED whenever a `Bun` or
        // `Deno` global was present, on the theory that a `decodebin` pipeline's
        // streaming threads race the JS engine's GC through the node-gi reverse
        // bridge. That defect was real but its cause was not the runtime: it was
        // a `(transfer full)` GObject IN-arg ownership bug in node-gi's
        // marshaller, fixed upstream. With that fixed, decode AND playback run on
        // node, bun and deno — measured, not assumed. This asserts the property
        // the removal claims: nothing in this package branches on which JS
        // runtime it is running under, so a re-introduced runtime sniff fails
        // here instead of silently removing a working capability again.
        await it('decodes and plays with a bun/deno global present', async () => {
            const g = globalThis as { Bun?: unknown; Deno?: unknown };
            const hadBun = 'Bun' in g;
            const hadDeno = 'Deno' in g;
            try {
                // Only FAKE the global where it is absent (gjs, node) — that is
                // where a runtime sniff would have refused. On bun/deno the real
                // global is present and read-only, so assigning to it throws.
                if (!hadBun) g.Bun = {};
                if (!hadDeno) g.Deno = {};

                const buf = decodeAudioDataSync(createTestWav(0.05, 44100));
                expect(buf.sampleRate).toBe(44100);
                expect(buf.length > 0).toBe(true);

                // Playback builds a real pipeline; it must not be refused either.
                const ctx = new AudioContext();
                const source = ctx.createBufferSource();
                const gain = ctx.createGain();
                gain.gain.value = 0; // silent
                source.buffer = buf;
                source.connect(gain).connect(ctx.destination);
                source.start();
                source.stop();
            } finally {
                if (!hadBun) delete g.Bun;
                if (!hadDeno) delete g.Deno;
            }
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
            param._onChange = () => {
                called = true;
            };
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
            // Stop what we started: a pipeline left PLAYING is finalized in that
            // state at process exit and GStreamer logs a CRITICAL per element.
            node.stop();
        });

        await it('should fire onended after playback completes', async () => {
            const ctx = new AudioContext();
            const wav = createTestWav(0.05, 44100); // 50ms
            const buf = await ctx.decodeAudioData(wav);

            const source = ctx.createBufferSource();
            const gain = ctx.createGain();
            gain.gain.value = 0; // silent
            source.buffer = buf;
            source.connect(gain).connect(ctx.destination);

            let ended = false;
            source.onended = () => {
                ended = true;
            };
            source.start();

            // Wait for playback to finish (50ms buffer + margin)
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
            expect(ended).toBe(true);
        });

        await it('should not fire onended while looping', async () => {
            const ctx = new AudioContext();
            const wav = createTestWav(0.05, 44100); // 50ms
            const buf = await ctx.decodeAudioData(wav);

            const source = ctx.createBufferSource();
            const gain = ctx.createGain();
            gain.gain.value = 0; // silent
            source.buffer = buf;
            source.loop = true;
            source.connect(gain).connect(ctx.destination);

            let ended = false;
            source.onended = () => {
                ended = true;
            };
            source.start();

            // Wait longer than one full play cycle
            await new Promise<void>((resolve) => setTimeout(resolve, 300));
            expect(ended).toBe(false);

            // Explicitly stop — should fire onended
            source.stop();
            expect(ended).toBe(true);
        });

        await it('should support connect chain source→gain→destination', async () => {
            const ctx = new AudioContext();
            const source = ctx.createBufferSource();
            const gain = ctx.createGain();
            const result = source.connect(gain).connect(ctx.destination);
            expect(result).toBe(ctx.destination);
            expect(source._outputs.has(gain)).toBe(true);
            expect(gain._outputs.has(ctx.destination)).toBe(true);
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

    await describe('GStreamer teardown', async () => {
        await it('leaves no pipeline live after stopAllPipelines()', () => {
            // The last line of defence for a host with no exit hook to attach to.
            // `GstPlayer` defers its NULL transition to a LOW-priority GLib idle,
            // and this runner quits the main loop before idles of that priority
            // are reached — so a pipeline started above would be finalized in
            // PLAYING and GStreamer would log a CRITICAL for every element it
            // owns. The registry exists precisely so a host can drain it
            // synchronously; a GTK app gets this from `GApplication::shutdown`,
            // node/bun/deno from `process.on('exit')`, and a gjs test from here
            // (`@gjsify/unit` exits through `system.exit()`, which emits neither).
            stopAllPipelines();
            expect(livePipelineCount()).toBe(0);
        });
    });

    // The host WITHOUT GStreamer — the one this suite could never be run on.
    //
    // Every test above needs GStreamer, so the whole file only ever ran where it
    // is installed, and the branch that matters when it is NOT (the batteries-
    // included GTK bundles ship no Gst at all) went unexecuted until a user hit
    // it: `gjsify showcase excalibur-jelly-jumper --runtime node` on Windows 11
    // died in `new AudioContext()` before the game rendered a frame.
    //
    // `tryEnsureGstInit` takes its initializer so that host is reachable from
    // this one: a throwing initializer IS a machine without GStreamer, as far as
    // everything downstream can tell.
    await describe('no GStreamer on this host', async () => {
        const absent = () => {
            throw new Error("Failed to require Gst 1.0: Typelib file for namespace 'Gst' not found");
        };

        await it('reports the reason instead of throwing', () => {
            const reason = tryEnsureGstInit(absent);
            expect(typeof reason).toBe('string');
            expect(reason).toContain('Gst 1.0');
        });

        await it('answers null when the bring-up succeeds', () => {
            expect(tryEnsureGstInit(() => {})).toBeNull();
        });

        await it('does not poison the process-wide memo', () => {
            // A caller passing its own initializer is asking about ONE outcome.
            // If that answer were cached, this suite would leave every later
            // `AudioContext` in the process convinced audio is unavailable.
            tryEnsureGstInit(absent);
            expect(tryEnsureGstInit()).toBeNull();
        });

        // THE REGRESSION ITSELF. `new AudioContext()` used to call the throwing
        // bring-up, so on a host with no GStreamer it took the whole application
        // down — Excalibur constructs one during its boot-time audio unlock, so
        // the jelly-jumper showcase never reached its first frame on Windows.
        await it('still constructs an AudioContext, and it is usable', () => {
            primeGstOutcomeForTests("Failed to require Gst 1.0: Typelib file for namespace 'Gst' not found");
            try {
                const ctx = new AudioContext();
                expect(ctx.destination).toBeDefined();
                // Silent, but not broken: the graph still builds, and a source
                // that cannot play must still settle its `onended` awaiter.
                expect(ctx.createGain()).toBeDefined();
                expect(ctx.createBufferSource()).toBeDefined();
                expect(ctx.currentTime >= 0).toBe(true);
            } finally {
                primeGstOutcomeForTests(undefined);
            }
        });
    });
};
