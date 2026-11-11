// The session against a scripted engine, a scripted source and (for one case) the
// VAD's fake engine. NO model, NO prebuild, NO microphone: what is asserted is the
// event order and the result list, which is the part the spec dictates and the
// part an engine cannot get wrong for us.

import { describe, expect, it } from '@gjsify/unit';
import { createFakeVadEngine, createVad } from '@gjsify/vad';

import { createFakeRecognizerEngine, type FakeRecognizerEngine } from './fake-engine.js';
import { SpeechRecognition, type PcmReader } from './recognition.js';
import { SpeechRecognitionPhrase } from './results.js';
import type { SpeechRecognitionErrorEvent, SpeechRecognitionEvent } from './events.js';

/** `chunks` of 100 ms of silence at 16 kHz, then end of stream — or held open until stop() when `hold`. */
function fakeSource(chunks: number, hold = false): PcmReader & { stopped: boolean } {
    let left = chunks;
    let waiting: ((value: null) => void) | null = null;
    const source = {
        stopped: false,
        sampleRate: 16000,
        format: 'S16LE' as const,
        async read() {
            if (source.stopped) return null;
            if (left > 0) {
                left--;
                await Promise.resolve();
                return new Int16Array(1600);
            }
            if (!hold) return null;
            return new Promise<null>((resolve) => {
                waiting = resolve;
            });
        },
        stop() {
            source.stopped = true;
            waiting?.(null);
        },
    };
    return source;
}

interface Session {
    types: string[];
    results: SpeechRecognitionEvent[];
    errors: SpeechRecognitionErrorEvent[];
    ended: Promise<void>;
}

const TYPES = [
    'start',
    'audiostart',
    'soundstart',
    'speechstart',
    'speechend',
    'soundend',
    'audioend',
    'result',
    'nomatch',
    'error',
    'end',
];

function record(recognition: SpeechRecognition): Session {
    const session = { types: [], results: [], errors: [] } as unknown as Session;
    session.ended = new Promise<void>((resolve) => {
        for (const type of TYPES) {
            recognition.addEventListener(type, (event) => {
                session.types.push(type);
                if (type === 'result') session.results.push(event as SpeechRecognitionEvent);
                if (type === 'error') session.errors.push(event as unknown as SpeechRecognitionErrorEvent);
                if (type === 'end') resolve();
            });
        }
    });
    return session;
}

function make(options: { engine?: FakeRecognizerEngine; source?: PcmReader; vad?: boolean } = {}) {
    const engine = options.engine ?? createFakeRecognizerEngine();
    const recognition = new SpeechRecognition({
        engine: () => engine,
        vad: () => null,
        source: () => options.source ?? fakeSource(10),
    });
    recognition.lang = 'de-DE';
    return { engine, recognition, session: record(recognition) };
}

const transcripts = (event: SpeechRecognitionEvent) =>
    Array.from({ length: event.results.length }, (_, i) => event.results.item(i).item(0).transcript);

export default async () => {
    await describe('SpeechRecognition session', async () => {
        await it('delivers interim and one final result, then ends (non-continuous)', async () => {
            const { engine, recognition, session } = make();
            engine.script([
                { text: '' },
                { text: 'hallo' },
                { text: 'hallo welt' },
                { text: 'hallo welt', endpoint: true },
            ]);
            recognition.interimResults = true;
            recognition.start();
            await session.ended;

            expect(session.types).toStrictEqual([
                'start',
                'audiostart',
                'soundstart',
                'speechstart',
                'result',
                'result',
                'speechend',
                'soundend',
                'result',
                'audioend',
                'end',
            ]);
            expect(transcripts(session.results[0])).toStrictEqual(['hallo']);
            expect(session.results[0].results.item(0).isFinal).toBe(false);
            expect(transcripts(session.results[1])).toStrictEqual(['hallo welt']);
            const final = session.results[2];
            expect(transcripts(final)).toStrictEqual(['hallo welt']);
            expect(final.results.item(0).isFinal).toBe(true);
            expect(final.resultIndex).toBe(0);
            expect(engine.closed).toBe(true);
        });

        await it('sends no interim results unless asked', async () => {
            const { engine, recognition, session } = make();
            engine.script([{ text: 'hallo' }, { text: 'hallo welt', endpoint: true }]);
            recognition.start();
            await session.ended;
            expect(session.results.length).toBe(1);
            expect(session.results[0].results.item(0).isFinal).toBe(true);
        });

        await it('keeps finals and spaces them in continuous mode until stop()', async () => {
            const engine = createFakeRecognizerEngine();
            const { recognition, session } = make({ engine, source: fakeSource(4, true) });
            engine.script([
                { text: 'eins', endpoint: true },
                { text: 'zwei', endpoint: true },
            ]);
            recognition.continuous = true;
            recognition.start();
            await new Promise((resolve) => setTimeout(resolve, 20));
            recognition.stop();
            await session.ended;

            const finals = session.results.filter((e) => e.results.item(e.results.length - 1).isFinal);
            expect(finals.length).toBe(2);
            expect(transcripts(finals[1])).toStrictEqual(['eins', ' zwei']);
            expect(finals[1].resultIndex).toBe(1);
            expect(session.types[session.types.length - 1]).toBe('end');
        });

        await it('stop() still delivers the pending utterance', async () => {
            const engine = createFakeRecognizerEngine();
            const { recognition, session } = make({ engine, source: fakeSource(2, true) });
            engine.script([{ text: 'noch offen' }]);
            engine.setTailText('noch offen am ende');
            recognition.start();
            await new Promise((resolve) => setTimeout(resolve, 20));
            recognition.stop();
            await session.ended;
            expect(transcripts(session.results[session.results.length - 1])).toStrictEqual(['noch offen am ende']);
            expect(session.results[session.results.length - 1].results.item(0).isFinal).toBe(true);
        });

        await it('abort() discards the pending utterance and fires only end after it', async () => {
            const engine = createFakeRecognizerEngine();
            const { recognition, session } = make({ engine, source: fakeSource(2, true) });
            engine.script([{ text: 'verworfen' }]);
            recognition.start();
            await new Promise((resolve) => setTimeout(resolve, 20));
            recognition.abort();
            await session.ended;
            expect(session.results.length).toBe(0);
            expect(session.errors.length).toBe(0);
            expect(session.types[session.types.length - 1]).toBe('end');
        });

        await it('reports no-speech when nothing was recognized', async () => {
            const { recognition, session } = make();
            recognition.start();
            await session.ended;
            expect(session.errors.map((e) => e.error)).toStrictEqual(['no-speech']);
            expect(session.types).toStrictEqual(['start', 'audiostart', 'error', 'audioend', 'end']);
        });

        await it('finalizes on the VAD speech end, ahead of the model endpoint', async () => {
            const engine = createFakeRecognizerEngine();
            const vadEngine = createFakeVadEngine();
            const recognition = new SpeechRecognition({
                engine: () => engine,
                vad: () => createVad({ engine: vadEngine }),
                source: () => fakeSource(6),
            });
            recognition.lang = 'de';
            const session = record(recognition);
            engine.script([{ text: 'guten' }, { text: 'guten tag' }]);
            engine.setTailText('guten tag zusammen');
            vadEngine.setSpeech(true);
            recognition.start();
            await new Promise((resolve) => setTimeout(resolve, 5));
            vadEngine.pushSegment(0, 3200);
            vadEngine.setSpeech(false);
            await session.ended;
            const finals = session.results.filter((e) => e.results.item(e.results.length - 1).isFinal);
            expect(finals.length).toBe(1);
            expect(transcripts(finals[0])).toStrictEqual(['guten tag zusammen']);
            expect(engine.tailFlushes > 0).toBe(true);
        });

        await it('fires nomatch for a final without a hypothesis', async () => {
            const engine = createFakeRecognizerEngine();
            const vadEngine = createFakeVadEngine();
            const recognition = new SpeechRecognition({
                engine: () => engine,
                vad: () => createVad({ engine: vadEngine }),
                source: () => fakeSource(6),
            });
            recognition.lang = 'de';
            const session = record(recognition);
            vadEngine.setSpeech(true);
            recognition.start();
            await new Promise((resolve) => setTimeout(resolve, 5));
            vadEngine.pushSegment(0, 3200);
            vadEngine.setSpeech(false);
            await session.ended;
            expect(session.types.includes('nomatch')).toBe(true);
            expect(session.results.length).toBe(0);
        });

        await it('puts the speech times on the session timeline', async () => {
            const engine = createFakeRecognizerEngine();
            const { recognition, session } = make({ engine });
            engine.script([{ text: 'a', endpoint: true }]);
            engine.setDetail({ timestamps: [0.2, 0.6], logProbs: [Math.log(0.5), Math.log(0.5)] });
            recognition.start();
            await session.ended;
            const result = session.results[0].results.item(0);
            expect(result.speechStartTime).toBe(0.2);
            expect(result.speechEndTime).toBe(0.6);
            expect(result.item(0).confidence).toBe(0.5);
        });
    });

    await describe('SpeechRecognition guards', async () => {
        await it('throws InvalidStateError on a second start()', async () => {
            const { recognition, session } = make();
            recognition.start();
            let name = '';
            try {
                recognition.start();
            } catch (error) {
                name = (error as Error).name;
            }
            expect(name).toBe('InvalidStateError');
            recognition.abort();
            await session.ended;
        });

        await it('rejects a start(track) that is not a live audio track', async () => {
            const { recognition } = make();
            let name = '';
            try {
                recognition.start({ kind: 'video', readyState: 'live' });
            } catch (error) {
                name = (error as Error).name;
            }
            expect(name).toBe('InvalidStateError');
        });

        await it('fires language-not-supported, then end, for a language without a model', async () => {
            const { recognition, session } = make();
            recognition.lang = 'xx-XX';
            recognition.start();
            await session.ended;
            expect(session.errors.map((e) => e.error)).toStrictEqual(['language-not-supported']);
            expect(session.types).toStrictEqual(['error', 'end']);
        });

        await it('fires phrases-not-supported for a model that cannot be biased', async () => {
            const { recognition, session } = make();
            recognition.phrases.push(new SpeechRecognitionPhrase('gjsify', 5));
            recognition.start();
            await session.ended;
            expect(session.errors.map((e) => e.error)).toStrictEqual(['phrases-not-supported']);
        });

        await it('may be started again after end', async () => {
            const { recognition, session } = make();
            recognition.start();
            await session.ended;
            recognition.start();
            recognition.abort();
        });

        await it('keeps processLocally true and refuses false', async () => {
            const { recognition } = make();
            expect(recognition.processLocally).toBe(true);
            let name = '';
            try {
                recognition.processLocally = false;
            } catch (error) {
                name = (error as Error).name;
            }
            expect(name).toBe('NotSupportedError');
            recognition.processLocally = true;
        });

        await it('still discards the pending utterance on abort() after stop()', async () => {
            const { engine, recognition, session } = make({ source: fakeSource(2, true) });
            engine.script([{ text: 'hallo' }]);
            recognition.addEventListener('audiostart', () => {
                recognition.stop();
                recognition.abort();
            });
            recognition.start();
            await session.ended;
            expect(session.results.length).toBe(0);
            expect(session.types.includes('error')).toBe(false);
        });

        await it('fires an engine failure as error before end, and closes the engine', async () => {
            const engine = createFakeRecognizerEngine();
            const failing = {
                ...engine,
                accept(): never {
                    throw new Error('decode failed');
                },
                close: () => engine.close(),
            };
            const { recognition, session } = make({ engine: failing as unknown as FakeRecognizerEngine });
            recognition.start();
            await session.ended;
            expect(session.types.slice(-2)).toStrictEqual(['error', 'end']);
            expect(session.errors[0].message).toBe('decode failed');
            expect(engine.closed).toBe(true);
        });

        await it('supports on<event> handlers', async () => {
            const { recognition, session } = make();
            let ended = false;
            recognition.onend = () => {
                ended = true;
            };
            recognition.start();
            await session.ended;
            expect(ended).toBe(true);
        });
    });
};
