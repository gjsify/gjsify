// Spec tests against a fake Spiel speaker — queue semantics, events, voice mapping and the
// no-backend path. Deterministic: no D-Bus, no audio.

import { describe, expect, it } from '@gjsify/unit';

import { _resetSpeechBackendCache, describeSpeechSynthesisBackend, hasSpeechSynthesisBackend, loadSpeechSynthesisBackend } from './backend.js';
import { SpeechSynthesis } from './speech-synthesis.js';
import { SpeechSynthesisUtterance } from './utterance.js';
import { FakeSpeaker, PROVIDER, fakeNamespace, voice } from './fake-spiel.js';

const tick = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

const VOICES = [
    voice('de_DE-kerstin-low', 'Kerstin', ['de-DE']),
    voice('en_US-amy-low', 'Amy', ['en-US']),
];

async function setup(voices = VOICES, providers = [PROVIDER]) {
    _resetSpeechBackendCache();
    const speaker = new FakeSpeaker(voices, providers);
    const synth = new SpeechSynthesis({
        importer: async () => ({ default: fakeNamespace(speaker) }),
        hostOs: () => 'linux',
    });
    synth.getVoices();
    await tick();
    return { speaker, synth };
}

function record(u: SpeechSynthesisUtterance) {
    const log: string[] = [];
    for (const t of ['start', 'end', 'error', 'pause', 'resume', 'boundary']) {
        u.addEventListener(t, (e: any) => log.push(t === 'error' ? `error:${e.error}` : t));
    }
    return log;
}

export default async () => {
    await describe('SpeechSynthesis (fake Spiel)', async () => {
        await it('maps Spiel voices to SpeechSynthesisVoice', async () => {
            const { synth } = await setup();
            const [de, en] = synth.getVoices();
            expect(synth.getVoices().length).toBe(2);
            expect(de.voiceURI).toBe('ai.piper.Speech.Provider#de_DE-kerstin-low');
            expect(de.name).toBe('Kerstin');
            expect(de.lang).toBe('de-DE');
            expect(de.localService).toBe(true);
            expect(de.default).toBe(true);
            expect(en.default).toBe(false);
        });

        await it('fires voiceschanged on items-changed', async () => {
            const { synth, speaker } = await setup();
            let n = 0;
            synth.addEventListener('voiceschanged', () => n++);
            speaker.voices.set([VOICES[0]]);
            expect(n).toBe(1);
            expect(synth.getVoices().length).toBe(1);
        });

        await it('maps text, lang, voice, rate, pitch and volume onto the Spiel utterance', async () => {
            const { synth, speaker } = await setup();
            const u = new SpeechSynthesisUtterance('Hallo');
            u.voice = synth.getVoices()[0];
            u.rate = 1.5;
            u.pitch = 0.5;
            u.volume = 0.25;
            synth.speak(u);
            await tick();
            expect(speaker.last.text).toBe('Hallo');
            expect(speaker.last.language).toBe('de-DE');
            expect(speaker.last.voice?.identifier).toBe('de_DE-kerstin-low');
            expect(speaker.last.rate).toBe(1.5);
            expect(speaker.last.pitch).toBe(0.5);
            expect(speaker.last.volume).toBe(0.25);
        });

        await it('lang overrides the voice language', async () => {
            const { synth, speaker } = await setup();
            const u = new SpeechSynthesisUtterance('x');
            u.lang = 'en-GB';
            synth.speak(u);
            await tick();
            expect(speaker.last.language).toBe('en-GB');
        });

        await it('runs start → boundary → end and tracks speaking/pending', async () => {
            const { synth, speaker } = await setup();
            const a = new SpeechSynthesisUtterance('a');
            const b = new SpeechSynthesisUtterance('b');
            const la = record(a);
            const lb = record(b);
            synth.speak(a);
            synth.speak(b);
            await tick();
            expect(synth.speaking).toBe(true);
            expect(synth.pending).toBe(true);
            expect(speaker.spoken.length).toBe(1);
            speaker.emit('utterance-started', speaker.last);
            speaker.emit('word-started', speaker.last, 0, 1);
            speaker.emit('utterance-finished', speaker.last);
            expect(la).toStrictEqual(['start', 'boundary', 'end']);
            expect(speaker.spoken.length).toBe(2);
            expect(synth.pending).toBe(false);
            speaker.emit('utterance-started', speaker.last);
            speaker.emit('utterance-finished', speaker.last);
            expect(lb).toStrictEqual(['start', 'end']);
            expect(synth.speaking).toBe(false);
        });

        await it('boundary carries charIndex, charLength and name=word', async () => {
            const { synth, speaker } = await setup();
            const u = new SpeechSynthesisUtterance('hello world');
            let ev: any;
            u.addEventListener('boundary', (e) => (ev = e));
            synth.speak(u);
            await tick();
            speaker.emit('word-started', speaker.last, 6, 11);
            expect(ev.charIndex).toBe(6);
            expect(ev.charLength).toBe(5);
            expect(ev.name).toBe('word');
        });

        await it('cancel() drops the queue and errors the current utterance as canceled, once', async () => {
            const { synth, speaker } = await setup();
            const a = new SpeechSynthesisUtterance('a');
            const b = new SpeechSynthesisUtterance('b');
            const la = record(a);
            const lb = record(b);
            synth.speak(a);
            synth.speak(b);
            await tick();
            synth.cancel();
            expect(la).toStrictEqual(['error:canceled']);
            expect(lb).toStrictEqual([]);
            expect(synth.speaking).toBe(false);
            expect(synth.pending).toBe(false);
            expect(speaker.spoken.length).toBe(1);
        });

        await it('pause()/resume() toggle paused and fire events', async () => {
            const { synth, speaker } = await setup();
            const u = new SpeechSynthesisUtterance('a');
            const log = record(u);
            synth.speak(u);
            await tick();
            synth.pause();
            expect(synth.paused).toBe(true);
            synth.resume();
            expect(synth.paused).toBe(false);
            expect(log).toStrictEqual(['pause', 'resume']);
            expect(speaker.calls).toStrictEqual(['speak', 'pause', 'resume']);
        });

        await it('maps utterance-error to an error event and moves on', async () => {
            const { synth, speaker } = await setup();
            const a = new SpeechSynthesisUtterance('a');
            const b = new SpeechSynthesisUtterance('b');
            const la = record(a);
            synth.speak(a);
            synth.speak(b);
            await tick();
            speaker.emit('utterance-error', speaker.last, { code: 1, message: 'bad voice' });
            expect(la).toStrictEqual(['error:voice-unavailable']);
            expect(speaker.spoken.length).toBe(2);
        });

        await it('on<event> handler attributes work', async () => {
            const { synth, speaker } = await setup();
            const u = new SpeechSynthesisUtterance('a');
            let ended = false;
            u.onend = () => (ended = true);
            synth.speak(u);
            await tick();
            speaker.emit('utterance-finished', speaker.last);
            expect(ended).toBe(true);
        });
    });

    await describe('SpeechSynthesis without a backend', async () => {
        const quiet = async <T>(fn: () => Promise<T>) => {
            const w = console.warn;
            const e = console.error;
            const lines: string[] = [];
            console.warn = (...a: unknown[]) => lines.push(a.map(String).join(' '));
            console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
            try {
                return { result: await fn(), lines };
            } finally {
                console.warn = w;
                console.error = e;
            }
        };

        await it('typelib absent: getVoices() is [], speak() errors with synthesis-unavailable, one hint', async () => {
            _resetSpeechBackendCache();
            const synth = new SpeechSynthesis({
                hostOs: () => 'linux',
                importer: async () => {
                    throw new Error("Requiring Spiel, version 1.0: Typelib file for namespace 'Spiel' (any version) not found");
                },
            });
            const { lines } = await quiet(async () => {
                expect(synth.getVoices()).toStrictEqual([]);
                const u = new SpeechSynthesisUtterance('x');
                const log = record(u);
                synth.speak(u);
                synth.speak(new SpeechSynthesisUtterance('y'));
                await tick();
                expect(log).toStrictEqual(['error:synthesis-unavailable']);
                expect(synth.speaking).toBe(false);
                expect(synth.pending).toBe(false);
            });
            expect(lines.length).toBe(1);
            expect(lines[0].includes('org.project_spiel.SpielInstaller')).toBe(true);
            const { result, lines: queryLines } = await quiet(async () => [
                await hasSpeechSynthesisBackend(),
                await describeSpeechSynthesisBackend(),
            ]);
            expect(result[0]).toBe(false);
            expect(String(result[1]).startsWith('none (absent)')).toBe(true);
            expect(queryLines).toStrictEqual([]);
        });

        await it('typelib present but no provider: classified as unavailable with its own hint', async () => {
            _resetSpeechBackendCache();
            const speaker = new FakeSpeaker([], []);
            const backend = await loadSpeechSynthesisBackend({
                hostOs: () => 'linux',
                importer: async () => ({ default: fakeNamespace(speaker) }),
            });
            expect(backend.status).toBe('spiel');
            expect(await hasSpeechSynthesisBackend()).toBe(false);
            expect((await describeSpeechSynthesisBackend()).startsWith('none (no-providers)')).toBe(true);
        });

        await it('any other load error is a fault', async () => {
            _resetSpeechBackendCache();
            const backend = await loadSpeechSynthesisBackend({
                hostOs: () => 'linux',
                importer: async () => {
                    throw new Error('libspiel.so: cannot open shared object file');
                },
            });
            expect(backend.status).toBe('failed');
        });

        await it('darwin and win32 are absent without importing', async () => {
            for (const os of ['darwin', 'win32'] as const) {
                _resetSpeechBackendCache();
                let imported = false;
                const backend = await loadSpeechSynthesisBackend({
                    hostOs: () => os,
                    importer: async () => {
                        imported = true;
                        return { default: {} };
                    },
                });
                expect(backend.status).toBe('absent');
                expect(imported).toBe(false);
            }
        });
    });
};
