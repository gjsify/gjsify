// The stream path: a real GStreamer chain (`audiotestsrc ! … ! appsink`, silent,
// no audio device) from `@gjsify/media-capture` feeding a session. The engine is
// scripted, so this proves that capture, conversion and the session agree on the
// byte layout — not that anything was recognized.

import { describe, expect, it } from '@gjsify/unit';
import { Gst, ensureGstInit, openPcmSource } from '@gjsify/media-capture';

import { createFakeRecognizerEngine } from './fake-engine.js';
import { SpeechRecognition, type PcmReader } from './recognition.js';

function silentSource(): PcmReader | null {
    try {
        ensureGstInit();
        const src = Gst.ElementFactory.make('audiotestsrc', null);
        if (src === null) return null;
        (src as unknown as { wave: number }).wave = 4; // silence
        (src as unknown as { num_buffers: number }).num_buffers = 20;
        return openPcmSource({ source: src, sampleRate: 16000, format: 'S16LE' }) as PcmReader;
    } catch {
        return null;
    }
}

export default async () => {
    await describe('SpeechRecognition on a GStreamer source', async () => {
        const source = silentSource();
        if (source === null) {
            await it('skips: GStreamer or audiotestsrc is unavailable', async () => {
                console.warn('[speech-recognition] gst-source suite skipped — no GStreamer');
            });
            return;
        }
        source.stop();

        await it('reads PCM through the session and ends on end of stream', async () => {
            const engine = createFakeRecognizerEngine();
            const recognition = new SpeechRecognition({
                engine: () => engine,
                vad: () => null,
                source: () => silentSource()!,
            });
            recognition.lang = 'de';
            const types: string[] = [];
            await new Promise<void>((resolve) => {
                for (const type of ['start', 'audiostart', 'audioend', 'error', 'end']) {
                    recognition.addEventListener(type, () => {
                        types.push(type);
                        if (type === 'end') resolve();
                    });
                }
                recognition.start();
            });
            expect(types).toStrictEqual(['start', 'audiostart', 'error', 'audioend', 'end']);
            expect(engine.samplesAccepted > 0).toBe(true);
        });
    });
};
