// One test against the REAL libspiel, silent: audio goes to a fakesink. Skips when the host
// has no Spiel typelib or no speech provider (every CI runner today).

import { describe, expect, it } from '@gjsify/unit';

import { _resetSpeechBackendCache, hasSpeechSynthesisBackend, loadSpeechSynthesisBackend } from './backend.js';
import { SpeechSynthesis } from './speech-synthesis.js';
import { SpeechSynthesisUtterance } from './utterance.js';

export default async () => {
    await describe('SpeechSynthesis (real libspiel, fakesink)', async () => {
        await it('speaks a short utterance end to end, or skips', async () => {
            _resetSpeechBackendCache();
            let sink: unknown = null;
            try {
                const Gst = (await import('gi://Gst?version=1.0')).default as any;
                Gst.init(null);
                sink = Gst.ElementFactory.make('fakesink', null);
            } catch {
                console.log('SKIP: no GStreamer typelib');
                return;
            }
            const probe = await loadSpeechSynthesisBackend({
                configureSpeaker: (speaker) => speaker.set_property('sink', sink),
            });
            if (!(await hasSpeechSynthesisBackend()) || probe.speaker!.voices.get_n_items() === 0) {
                console.log(`SKIP: no libspiel/provider/voice (${probe.status})`);
                return;
            }
            const synth = new SpeechSynthesis();
            // The first getVoices() starts the probe and answers [] until it settles.
            synth.getVoices();
            for (let i = 0; i < 20; i++) await Promise.resolve();
            const voices = synth.getVoices();
            expect(voices.length > 0).toBe(true);
            const u = new SpeechSynthesisUtterance('Hallo Welt');
            u.voice = voices.find((v) => v.lang.startsWith('de')) ?? voices[0];
            const events: string[] = [];
            const done = new Promise<void>((resolve) => {
                u.addEventListener('start', () => events.push('start'));
                u.addEventListener('end', () => {
                    events.push('end');
                    resolve();
                });
                u.addEventListener('error', (e: any) => {
                    events.push(`error:${e.error}`);
                    resolve();
                });
            });
            synth.speak(u);
            await Promise.race([done, new Promise<void>((r) => setTimeout(r, 20000))]);
            expect(events[0]).toBe('start');
            expect(events[events.length - 1]).toBe('end');
        });
    });
};
