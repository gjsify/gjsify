// A scripted {@link RecognizerEngine} for the specs.
//
// The session's event order is the part of this package most likely to be wrong, and
// it needs neither a model nor an inference run: every case is a sequence of
// "what text does the engine hold now" and "did the model call an endpoint". The
// specs script those two answers per `accept()` call and assert the events.
//
// EXPORTED for the same reason `@gjsify/vad` exports its fake: a consumer testing an
// app on top of `SpeechRecognition` needs the same stand-in.

import type { RecognizerDetail, RecognizerEngine, RecognizerFrame } from './backend.js';

export interface FakeEngineStep {
    text: string;
    endpoint?: boolean;
}

export interface FakeRecognizerEngine extends RecognizerEngine {
    /** Frames the next `accept()` calls answer, one per call; the last repeats. */
    script(steps: readonly FakeEngineStep[]): void;
    /** What `flushTail()` answers (default: the last text). */
    setTailText(text: string): void;
    setDetail(detail: Partial<RecognizerDetail>): void;
    readonly samplesAccepted: number;
    readonly resets: number;
    readonly tailFlushes: number;
    readonly opened: boolean;
    readonly closed: boolean;
}

export function createFakeRecognizerEngine(): FakeRecognizerEngine {
    let steps: FakeEngineStep[] = [];
    let cursor = 0;
    let last: FakeEngineStep = { text: '' };
    let tail: string | null = null;
    let detail: RecognizerDetail = { tokens: [], timestamps: [], logProbs: [] };
    const state = { samples: 0, resets: 0, tails: 0, opened: false, closed: false };

    const frame = (step: FakeEngineStep): RecognizerFrame => ({ text: step.text, endpoint: step.endpoint ?? false });

    return {
        script(next) {
            steps = [...next];
            cursor = 0;
        },
        setTailText(text) {
            tail = text;
        },
        setDetail(next) {
            detail = { tokens: [], timestamps: [], logProbs: [], ...next };
        },
        get samplesAccepted() {
            return state.samples;
        },
        get resets() {
            return state.resets;
        },
        get tailFlushes() {
            return state.tails;
        },
        get opened() {
            return state.opened;
        },
        get closed() {
            return state.closed;
        },
        open() {
            state.opened = true;
        },
        accept(samples) {
            state.samples += samples.length;
            if (cursor < steps.length) last = steps[cursor++];
            return frame(last);
        },
        flushTail() {
            state.tails++;
            return frame({ text: tail ?? last.text });
        },
        detail: () => detail,
        reset() {
            state.resets++;
            last = { text: '' };
            tail = null;
        },
        close() {
            state.closed = true;
        },
    };
}
