// The event state machine, driven against `createFakeVadEngine()`.
//
// No model, no prebuild, no inference and no audio device: every case below is
// a sequence of the engine's two observable answers, which is what makes them
// runnable on a CI host that has none of those (ADR 0127 decision 14).

import { describe, expect, it } from '@gjsify/unit';

import { createFakeVadEngine, type FakeVadEngine } from './fake-vad.js';
import { toFloatSamples } from './pcm.js';
import { VoiceActivityDetector, type SpeechEndEvent, type VadEvent } from './vad.js';

/** 100 ms at 16 kHz. */
const CHUNK = new Float32Array(1600);

function detector(): { vad: VoiceActivityDetector; fake: FakeVadEngine } {
    const fake = createFakeVadEngine();
    const vad = new VoiceActivityDetector({ engine: fake });
    vad.open();
    return { vad, fake };
}

const types = (events: VadEvent[]): string[] => events.map((e) => e.type);

export default async () => {
    await describe('VoiceActivityDetector defaults', async () => {
        await it("defaults the minimum silence to 300 ms, not Silero's 550", async () => {
            const { vad } = detector();
            expect(vad.minSilenceMs).toBe(300);
            expect(vad.minSpeechMs).toBe(250);
            expect(vad.maxSpeechMs).toBe(20000);
            expect(vad.sampleRate).toBe(16000);
        });

        await it('refuses a non-positive knob instead of passing it to the engine', async () => {
            expect(() => new VoiceActivityDetector({ engine: createFakeVadEngine(), minSilenceMs: 0 })).toThrow(
                RangeError,
            );
            expect(() => new VoiceActivityDetector({ engine: createFakeVadEngine(), sampleRate: -1 })).toThrow(
                RangeError,
            );
        });

        await it('opens once and closes once', async () => {
            const { vad, fake } = detector();
            vad.open();
            expect(fake.opened).toBe(true);
            expect(vad.isOpen).toBe(true);
            vad.close();
            vad.close();
            expect(fake.closed).toBe(true);
            expect(vad.isOpen).toBe(false);
            expect(() => vad.accept(CHUNK)).toThrow();
        });
    });

    await describe('VoiceActivityDetector timeline', async () => {
        await it('counts accepted samples, not chunks', async () => {
            const { vad, fake } = detector();
            vad.accept(CHUNK);
            vad.accept(new Float32Array(800));
            expect(vad.positionSamples).toBe(2400);
            expect(vad.position).toBeCloseTo(0.15, 6);
            expect(fake.accepted).toBe(2400);
            expect(fake.chunks).toBe(2);
        });

        await it('converts S16LE bytes before feeding them', async () => {
            const { vad, fake } = detector();
            const bytes = new Uint8Array(4);
            new DataView(bytes.buffer).setInt16(0, -32768, true);
            new DataView(bytes.buffer).setInt16(2, 16384, true);
            vad.accept(bytes, 'S16LE');
            expect(fake.accepted).toBe(2);
            expect(toFloatSamples(bytes, 'S16LE')[0]).toBe(-1);
            expect(toFloatSamples(bytes, 'S16LE')[1]).toBe(0.5);
        });
    });

    await describe('VoiceActivityDetector events', async () => {
        await it('reports speech-start at the live edge, once', async () => {
            const { vad, fake } = detector();
            expect(types(vad.accept(CHUNK))).toStrictEqual([]);
            fake.setSpeech(true);
            const started = vad.accept(CHUNK);
            expect(types(started)).toStrictEqual(['speech-start']);
            expect(started[0].type === 'speech-start' && started[0].at).toBeCloseTo(0.2, 6);
            expect(vad.speaking).toBe(true);
            // Still inside speech: nothing new falls due.
            expect(types(vad.accept(CHUNK))).toStrictEqual([]);
        });

        await it('reports speech-end with the back-dated onset from the segment', async () => {
            const { vad, fake } = detector();
            fake.setSpeech(true);
            vad.accept(CHUNK);
            vad.accept(CHUNK);
            // The segment began before the live edge saw it — 0.05 s in, 1.0 s long.
            fake.pushSegment(800, 16000);
            fake.setSpeech(false);
            const events = vad.accept(CHUNK);
            expect(types(events)).toStrictEqual(['speech-end']);
            const end = events[0] as SpeechEndEvent;
            expect(end.start).toBeCloseTo(0.05, 6);
            expect(end.duration).toBeCloseTo(1, 6);
            expect(end.end).toBeCloseTo(1.05, 6);
            expect(end.startSample).toBe(800);
            expect(end.samples.length).toBe(16000);
            expect(vad.speaking).toBe(false);
        });

        await it('synthesises a speech-start for a stretch that began and ended inside one chunk', async () => {
            const { vad, fake } = detector();
            // The live edge never went true: a short utterance inside a long chunk.
            fake.pushSegment(1600, 8000);
            const events = vad.accept(new Float32Array(32000));
            expect(types(events)).toStrictEqual(['speech-start', 'speech-end']);
            expect(events[0].type === 'speech-start' && events[0].at).toBeCloseTo(0.1, 6);
            expect((events[1] as SpeechEndEvent).start).toBeCloseTo(0.1, 6);
        });

        await it('never reports speech-end without a speech-start before it', async () => {
            const { vad, fake } = detector();
            fake.pushSegment(0, 1600);
            fake.pushSegment(16000, 1600);
            const events = vad.accept(new Float32Array(32000));
            expect(types(events)).toStrictEqual(['speech-start', 'speech-end', 'speech-start', 'speech-end']);
        });

        await it('reads a maxSpeechMs cut as speech-end followed by a fresh speech-start', async () => {
            const { vad, fake } = detector();
            fake.setSpeech(true);
            vad.accept(CHUNK);
            // The engine cut the stretch at the limit but is still inside speech.
            fake.pushSegment(0, 16000);
            const events = vad.accept(CHUNK);
            expect(types(events)).toStrictEqual(['speech-end', 'speech-start']);
            expect(vad.speaking).toBe(true);
        });

        await it('leaves a discarded burst as a speech-start with no speech-end', async () => {
            const { vad, fake } = detector();
            fake.setSpeech(true);
            expect(types(vad.accept(CHUNK))).toStrictEqual(['speech-start']);
            // Too short to keep: the live edge drops and the engine queues nothing.
            fake.setSpeech(false);
            expect(types(vad.accept(CHUNK))).toStrictEqual([]);
            expect(vad.speaking).toBe(false);
        });
    });

    await describe('VoiceActivityDetector flush and reset', async () => {
        await it('flush closes the last stretch, which nothing else would', async () => {
            const { vad, fake } = detector();
            fake.setSpeech(true);
            expect(types(vad.accept(CHUNK))).toStrictEqual(['speech-start']);
            fake.pushSegment(0, 1600);
            const events = vad.flush();
            expect(fake.flushed).toBe(1);
            expect(types(events)).toStrictEqual(['speech-end']);
            expect(vad.speaking).toBe(false);
        });

        await it('flush on silence is empty, and the detector keeps taking audio', async () => {
            const { vad, fake } = detector();
            vad.accept(CHUNK);
            expect(vad.flush()).toStrictEqual([]);
            fake.setSpeech(true);
            const events = vad.accept(CHUNK);
            expect(types(events)).toStrictEqual(['speech-start']);
            // The timeline ran on across the flush.
            expect(events[0].type === 'speech-start' && events[0].at).toBeCloseTo(0.2, 6);
        });

        await it('flush before open does nothing rather than opening the model', async () => {
            const fake = createFakeVadEngine();
            const vad = new VoiceActivityDetector({ engine: fake });
            expect(vad.flush()).toStrictEqual([]);
            expect(fake.opened).toBe(false);
        });

        await it('reset forgets the timeline, the queue and the live edge', async () => {
            const { vad, fake } = detector();
            fake.setSpeech(true);
            vad.accept(CHUNK);
            fake.pushSegment(0, 1600);
            vad.reset();
            expect(fake.resets).toBe(1);
            expect(vad.positionSamples).toBe(0);
            expect(vad.speaking).toBe(false);
            expect(vad.accept(CHUNK)).toStrictEqual([]);
        });
    });

    await describe('VoiceActivityDetector.run', async () => {
        await it('drives a PcmSource-like object and flushes at end of stream', async () => {
            const { vad, fake } = detector();
            const source = {
                sampleRate: 16000,
                format: 'S16LE' as const,
                async *[Symbol.asyncIterator]() {
                    yield new Uint8Array(3200);
                    fake.setSpeech(true);
                    yield new Uint8Array(3200);
                    fake.pushSegment(1600, 1600);
                    fake.setSpeech(false);
                    yield new Uint8Array(3200);
                },
            };
            const events: VadEvent[] = [];
            for await (const event of vad.run(source)) events.push(event);
            expect(types(events)).toStrictEqual(['speech-start', 'speech-end']);
            expect(vad.positionSamples).toBe(4800);
        });

        await it('takes a bare async iterable of typed arrays', async () => {
            const { vad, fake } = detector();
            async function* chunks() {
                yield new Int16Array(1600);
                fake.pushSegment(0, 1600);
                yield new Int16Array(1600);
            }
            const events: VadEvent[] = [];
            for await (const event of vad.run(chunks())) events.push(event);
            expect(types(events)).toStrictEqual(['speech-start', 'speech-end']);
        });

        await it('refuses a source whose sample rate is not the one it was built for', async () => {
            const { vad } = detector();
            const source = {
                sampleRate: 48000,
                async *[Symbol.asyncIterator]() {
                    yield new Float32Array(1600);
                },
            };
            await expect(
                (async () => {
                    for await (const _ of vad.run(source)) break;
                })(),
            ).rejects.toThrow(/48000/);
        });
    });
};
