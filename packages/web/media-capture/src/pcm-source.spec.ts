// openPcmSource against audiotestsrc and filesrc into an appsink: no capture
// device is opened and nothing reaches a speaker. The default source (the
// host's microphone) is deliberately not exercised.

import GLib from 'gi://GLib?version=2.0';
import { describe, it, expect } from '@gjsify/unit';

import { Gst, ensureGstInit } from './gst-init.js';
import { openPcmSource } from './pcm-source.js';

/**
 * One second of 44.1 kHz stereo sine as ten 100 ms buffers. audiotestsrc itself
 * produces whatever rate is asked of it downstream, so the caps behind it pin
 * the source rate and give the resampler real work.
 */
function tone(props = ''): Gst.Element {
    return Gst.parse_bin_from_description(
        `audiotestsrc num-buffers=10 samplesperbuffer=4410 freq=440 volume=0.5 ${props} ! capsfilter caps="audio/x-raw,rate=44100,channels=2"`,
        true,
    );
}

async function drain(pcm: ReturnType<typeof openPcmSource>): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for await (const chunk of pcm) parts.push(chunk);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/** A mono 8 kHz S16LE WAV holding one second of a ramp. */
function wavFile(): { path: string; samples: number } {
    const samples = 8000;
    const data = new Uint8Array(44 + samples * 2);
    const v = new DataView(data.buffer);
    const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    tag(0, 'RIFF');
    v.setUint32(4, 36 + samples * 2, true);
    tag(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    tag(36, 'data');
    v.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, (i % 100) * 100, true);
    const path = GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-media-capture-${GLib.random_int()}.wav`]);
    GLib.file_set_contents(path, data);
    return { path, samples };
}

export default async () => {
    await describe('openPcmSource', async () => {
        await it('delivers 16 kHz mono S16LE from a stereo 44.1 kHz tone', async () => {
            ensureGstInit();
            const pcm = openPcmSource({ source: tone() });
            expect(pcm.sampleRate).toBe(16000);
            expect(pcm.format).toBe('S16LE');
            expect(pcm.channels).toBe(1);

            const bytes = await drain(pcm);
            // One second is 16000 samples of 2 bytes; the resampler may hold back a few frames at EOS.
            expect(bytes.length > 31000 && bytes.length <= 32100).toBe(true);
            expect(bytes.length % 2).toBe(0);

            const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
            let peak = 0;
            for (const s of samples) peak = Math.max(peak, Math.abs(s));

            // volume 0.5 of full scale, give or take the resampler's ripple
            expect(peak > 14000 && peak < 18000).toBe(true);
        });

        await it('labels a bare test source as synthetic', async () => {
            ensureGstInit();
            const src = Gst.ElementFactory.make('audiotestsrc', null)!;
            (src as unknown as { num_buffers: number }).num_buffers = 1;
            const pcm = openPcmSource({ source: src });
            expect(pcm.synthetic).toBe(true);
            expect(pcm.label).toBe('audiotestsrc');
            expect((await drain(pcm)).length > 0).toBe(true);
        });

        await it('delivers F32LE at the requested rate', async () => {
            ensureGstInit();
            const bytes = await drain(openPcmSource({ source: tone(), format: 'F32LE', sampleRate: 8000 }));
            // 8000 samples of 4 bytes
            expect(bytes.length > 31000 && bytes.length <= 32100).toBe(true);
            const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
            let peak = 0;
            for (const s of samples) peak = Math.max(peak, Math.abs(s));
            expect(peak > 0.4 && peak < 0.6).toBe(true);
        });

        await it('reads silence as zeros', async () => {
            ensureGstInit();
            const bytes = await drain(openPcmSource({ source: tone('wave=silence') }));
            expect(bytes.length > 31000).toBe(true);
            expect(bytes.every((b) => b === 0)).toBe(true);
        });

        await it('upsamples a file source', async () => {
            ensureGstInit();
            const { path } = wavFile();
            try {
                const src = Gst.parse_bin_from_description(`filesrc location=${path} ! wavparse`, true);
                const pcm = openPcmSource({ source: src });
                expect(pcm.synthetic).toBe(false);
                const bytes = await drain(pcm);
                expect(bytes.length > 31000 && bytes.length <= 32100).toBe(true);
            } finally {
                GLib.unlink(path);
            }
        });

        await it('ends with null after the last chunk', async () => {
            ensureGstInit();
            const pcm = openPcmSource({ source: tone() });
            while ((await pcm.read()) !== null) {
                /* drain */
            }
            expect(await pcm.read()).toBe(null);
            pcm.stop();
        });

        await it('rejects when the source fails', async () => {
            ensureGstInit();
            const src = Gst.ElementFactory.make('filesrc', null)!;
            (src as unknown as { location: string }).location = '/nonexistent/gjsify-media-capture.raw';
            const pcm = openPcmSource({ source: src });
            let message = '';
            try {
                await pcm.read();
            } catch (e) {
                message = (e as Error).message;
            }
            expect(message.includes('openPcmSource')).toBe(true);
            pcm.stop();
        });

        await it('stop() ends a pending read with null and is idempotent', async () => {
            ensureGstInit();
            const pcm = openPcmSource({ source: tone('num-buffers=-1 is-live=true') });
            expect((await pcm.read()) instanceof Uint8Array).toBe(true);
            pcm.stop();
            pcm.stop();
            expect(await pcm.read()).toBe(null);
        });

        await it('rejects an invalid sample rate and format', async () => {
            ensureGstInit();
            let rate = '';
            let fmt = '';
            try {
                openPcmSource({ source: tone(), sampleRate: 0 });
            } catch (e) {
                rate = (e as Error).name;
            }
            try {
                openPcmSource({ source: tone(), format: 'U8' as never });
            } catch (e) {
                fmt = (e as Error).name;
            }
            expect(rate).toBe('RangeError');
            expect(fmt).toBe('TypeError');
        });
    });
};
