// A scripted {@link VadEngine} for the specs.
//
// The event state machine in `vad.ts` is the part of this package most likely
// to be wrong, and it is also the part that needs neither a model, a prebuild
// nor an inference run: every case it has to get right is a sequence of
// "is the engine inside speech" and "did a segment just complete". So the
// specs drive those two answers directly and assert the events — including the
// three cases a real recording will not produce on demand (a burst discarded
// as too short, a `maxSpeechMs` cut, a segment that opened and closed inside a
// single chunk).
//
// EXPORTED, not test-only-internal: a consumer writing its own turn detector
// on top of these events needs the same stand-in, and keeping it in the
// published surface is cheaper than having them rebuild it.

import type { EngineSegment, VadEngine } from './backend.js';

export interface FakeVadEngine extends VadEngine {
    /** What `isSpeech()` answers from now on. */
    setSpeech(live: boolean): void;
    /** Queue a completed segment; the next `accept()` drains it. */
    pushSegment(startSample: number, lengthSamples: number): void;
    /** Samples handed to `accept()` so far. */
    readonly accepted: number;
    /** `accept()` calls so far. */
    readonly chunks: number;
    readonly opened: boolean;
    readonly flushed: number;
    readonly resets: number;
    readonly closed: boolean;
}

/**
 * An engine that answers exactly what the test told it to.
 *
 * It does NOT simulate Silero: `setSpeech()` and `pushSegment()` are the
 * engine's two observable behaviours, and the point is to drive them into
 * combinations rather than to reproduce how a model would reach them.
 */
export function createFakeVadEngine(): FakeVadEngine {
    const queue: EngineSegment[] = [];
    let live = false;
    const state = { accepted: 0, chunks: 0, opened: false, flushed: 0, resets: 0, closed: false };

    const engine: FakeVadEngine = {
        get accepted() {
            return state.accepted;
        },
        get chunks() {
            return state.chunks;
        },
        get opened() {
            return state.opened;
        },
        get flushed() {
            return state.flushed;
        },
        get resets() {
            return state.resets;
        },
        get closed() {
            return state.closed;
        },

        setSpeech(value) {
            live = value;
        },
        pushSegment(startSample, lengthSamples) {
            // Filled with a constant rather than noise: the specs assert the
            // length and the offset, never the audio.
            queue.push({ samples: new Float32Array(lengthSamples).fill(0.5), startSample });
        },

        open() {
            state.opened = true;
        },
        accept(samples) {
            if (!state.opened) throw new Error('fake VAD engine: accept() before open()');
            state.accepted += samples.length;
            state.chunks++;
        },
        isSpeech() {
            return live;
        },
        hasSegment() {
            return queue.length > 0;
        },
        nextSegment() {
            return queue.shift() ?? null;
        },
        flush() {
            state.flushed++;
        },
        reset() {
            state.resets++;
            queue.length = 0;
            live = false;
        },
        close() {
            state.closed = true;
        },
    };
    return engine;
}
