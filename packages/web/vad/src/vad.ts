// Voice activity detection: when someone starts speaking, and when a stretch
// of speech has ended (ADR 0127 decision 10).
//
// WHAT THIS PACKAGE REFUSES TO SAY
// ────────────────────────────────
// Whether a pause means the speaker is FINISHED. That is a question about a
// conversation — how long this speaker usually hesitates, whether the sentence
// sounds complete, whether the app may interrupt — and it is answered by a
// turn detector above this layer, with its own policy. A VAD measures
// acoustics. `speech-start` and `speech-end` are the two things it can measure,
// and there is deliberately no `turn-end` to reach for.

import {
    createSherpaVadEngine,
    loadVadBackend,
    reportVadBackendOnce,
    type EngineSegment,
    type VadEngine,
} from './backend.js';
import { resolveModel } from './models.js';
import { toFloatSamples, type PcmChunk, type PcmFormat, type VadInput } from './pcm.js';

/** Speech has begun and is still going. */
export interface SpeechStartEvent {
    type: 'speech-start';
    /**
     * Stream position where the detector CONFIRMED speech, in seconds.
     *
     * This is the live edge, and it lags the acoustic onset — the detector has
     * to hear {@link VadOptions.minSpeechMs} of speech before it will commit.
     * Measured on two 16 kHz recordings with the defaults: confirmed at 0.67 s
     * and 0.38 s for onsets that the matching `speech-end` later reported at
     * 0.32 s and 0.03 s, so about 0.35 s behind in both.
     *
     * That lag is the right behaviour for a "listening" indicator, which must
     * not flicker on a cough. For trimming audio, use `speech-end.start`,
     * which is the onset itself.
     */
    at: number;
}

/** A completed stretch of speech, with its audio. */
export interface SpeechEndEvent {
    type: 'speech-end';
    /** Onset in seconds from the first sample accepted — back-dated by the detector, not the live edge. */
    start: number;
    /** End in seconds. */
    end: number;
    /** `end - start`. */
    duration: number;
    /** Onset in samples, for placing the audio without going through seconds. */
    startSample: number;
    /** The segment's audio: mono float in [-1, 1] at {@link VadOptions.sampleRate}. */
    samples: Float32Array;
}

export type VadEvent = SpeechStartEvent | SpeechEndEvent;

export interface VadOptions {
    /**
     * A model id from the manifest (`silero-v5`, `silero-v4`) or a path to an
     * `.onnx` file. An id must already be cached — `await install(id)` first.
     * Anything containing a path separator is used as given.
     */
    model?: string;
    /**
     * Silence that ends a stretch of speech, in ms. Default **300**.
     *
     * ADR 0127 decision 10's number, not Silero's 550: the whole wait is added
     * to every reply, and 300 ms is short enough not to feel late while still
     * sitting out the pause inside a sentence.
     */
    minSilenceMs?: number;
    /** Speech shorter than this is discarded as a click or a cough. Default 250 ms. */
    minSpeechMs?: number;
    /** A stretch is cut at this length even without a pause. Default 20 000 ms. */
    maxSpeechMs?: number;
    /** Speech probability above which a window counts as speech. Default 0.5. */
    threshold?: number;
    /** Sample rate of the audio fed to {@link VoiceActivityDetector.accept}. Default 16 000. */
    sampleRate?: number;
    /** Samples per inference window. Default 512, which is Silero at 16 kHz. */
    windowSize?: number;
    /** onnxruntime threads. Default 1 — enough for Silero and the cheapest. */
    numThreads?: number;
    /** The engine's internal ring buffer, in seconds. Default 30; must exceed `maxSpeechMs`. */
    bufferSeconds?: number;
    /** Make sherpa-onnx print its configuration and decisions to stderr. */
    debug?: boolean;
    /** Replace the native engine. Tests use `createFakeVadEngine()`; nothing else should. */
    engine?: VadEngine;
}

const DEFAULTS = {
    minSilenceMs: 300,
    minSpeechMs: 250,
    maxSpeechMs: 20000,
    threshold: 0.5,
    sampleRate: 16000,
    windowSize: 512,
    numThreads: 1,
    bufferSeconds: 30,
    debug: false,
} as const;

function positive(name: string, value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`VadOptions.${name} must be a positive number, got ${value}`);
    }
    return value;
}

/**
 * A voice activity detector over one audio stream.
 *
 * Feed it whatever chunks the capture source produced — any length, the engine
 * buffers the remainder — and it answers with the events that fell due:
 *
 * ```ts
 * const vad = createVad({ model: 'silero-v5' });
 * vad.open();
 * for await (const chunk of source) {
 *     for (const event of vad.accept(chunk, source.format)) {
 *         if (event.type === 'speech-start') showListening();
 *         else transcribe(event.samples);
 *     }
 * }
 * for (const event of vad.flush()) transcribe((event as SpeechEndEvent).samples);
 * vad.close();
 * ```
 *
 * `flush()` is not optional. The last utterance of a file or a stopped
 * recording is closed by nothing — no silence follows it — so without a flush
 * it is never reported at all.
 */
export class VoiceActivityDetector {
    readonly sampleRate: number;
    readonly minSilenceMs: number;
    readonly minSpeechMs: number;
    readonly maxSpeechMs: number;

    private readonly engine: VadEngine;
    private accepted = 0;
    private inSpeech = false;
    private opened = false;
    private closed = false;

    constructor(options: VadOptions = {}) {
        this.sampleRate = positive('sampleRate', options.sampleRate ?? DEFAULTS.sampleRate);
        this.minSilenceMs = positive('minSilenceMs', options.minSilenceMs ?? DEFAULTS.minSilenceMs);
        this.minSpeechMs = positive('minSpeechMs', options.minSpeechMs ?? DEFAULTS.minSpeechMs);
        this.maxSpeechMs = positive('maxSpeechMs', options.maxSpeechMs ?? DEFAULTS.maxSpeechMs);

        this.engine =
            options.engine ??
            createSherpaVadEngine({
                model: resolveModel(options.model),
                threshold: options.threshold ?? DEFAULTS.threshold,
                minSilenceSeconds: this.minSilenceMs / 1000,
                minSpeechSeconds: this.minSpeechMs / 1000,
                maxSpeechSeconds: this.maxSpeechMs / 1000,
                sampleRate: this.sampleRate,
                windowSize: positive('windowSize', options.windowSize ?? DEFAULTS.windowSize),
                numThreads: positive('numThreads', options.numThreads ?? DEFAULTS.numThreads),
                bufferSeconds: positive('bufferSeconds', options.bufferSeconds ?? DEFAULTS.bufferSeconds),
                debug: options.debug ?? DEFAULTS.debug,
            });
    }

    /** Load the model. Idempotent. Throws when the model file cannot be opened. */
    open(): void {
        if (this.closed) throw new Error('This VoiceActivityDetector is closed — create another one.');
        if (this.opened) return;
        this.engine.open();
        this.opened = true;
    }

    get isOpen(): boolean {
        return this.opened && !this.closed;
    }

    /** Whether the detector is inside speech right now — the live edge, for an indicator. */
    get speaking(): boolean {
        return this.inSpeech;
    }

    /** Seconds of audio accepted so far: the timeline the events are placed on. */
    get position(): number {
        return this.accepted / this.sampleRate;
    }

    /** Samples accepted so far. */
    get positionSamples(): number {
        return this.accepted;
    }

    /**
     * Feed one chunk and collect the events it completed.
     *
     * `format` is only consulted for a raw `Uint8Array`; an `Int16Array` or
     * `Float32Array` carries its own. Returns an empty array far more often
     * than not — nothing falls due in most chunks.
     */
    accept(chunk: PcmChunk, format?: PcmFormat): VadEvent[] {
        this.open();
        const samples = toFloatSamples(chunk, format);
        this.engine.accept(samples);
        this.accepted += samples.length;
        return this.collect(false);
    }

    /**
     * Close an in-progress stretch of speech and collect what that completed —
     * end of input.
     *
     * Idempotent and cheap on a detector that is not inside speech. Does not
     * close the detector: after a flush it keeps taking audio, with the
     * timeline running on.
     */
    flush(): VadEvent[] {
        if (!this.opened) return [];
        this.engine.flush();
        return this.collect(true);
    }

    /**
     * Drop every queued segment and the model state, and forget the timeline.
     *
     * For reusing one detector across unrelated recordings. A `speech-start`
     * already reported is not retracted — there is no event for that.
     */
    reset(): void {
        if (!this.opened) return;
        this.engine.reset();
        this.accepted = 0;
        this.inSpeech = false;
    }

    /** Release the model. Idempotent. The detector is not reusable afterwards. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.engine.close();
    }

    /**
     * Drive the detector from a capture source and yield its events.
     *
     * Takes `@gjsify/media-capture`'s `openPcmSource()` — structurally, so
     * neither package depends on the other — or any async iterable of chunks.
     * Flushes at the end of the stream, so the last utterance is reported; the
     * detector is left open, because the caller owns its lifetime.
     */
    async *run(source: VadInput): AsyncGenerator<VadEvent, void, undefined> {
        const declared = (source as { sampleRate?: number }).sampleRate;
        if (declared !== undefined && declared !== this.sampleRate) {
            throw new Error(
                `This detector was built for ${this.sampleRate} Hz and the source reports ${declared} Hz. ` +
                    'Resampled audio read at the wrong rate is not an error the detector can see — it just ' +
                    `reads as silence. Pass sampleRate: ${declared} to createVad(), or ask the source for ` +
                    `${this.sampleRate} Hz.`,
            );
        }
        const format = (source as { format?: PcmFormat }).format;
        for await (const chunk of source) {
            for (const event of this.accept(chunk, format)) yield event;
        }
        for (const event of this.flush()) yield event;
    }

    /**
     * The state machine, and the reason it is one function.
     *
     * COMPLETED SEGMENTS ARE DRAINED FIRST, then the live edge is read. The
     * order is what makes the three awkward cases come out right:
     *
     *   • Speech that began AND ended inside this one chunk never raised a live
     *     edge, so the drain emits a synthetic `speech-start` before its
     *     `speech-end`. A consumer never sees an end without a start.
     *   • A `maxSpeechMs` cut arrives as a queued segment while the live edge
     *     is still true, so it reads as `speech-end` immediately followed by a
     *     fresh `speech-start` — the stretch continues, under a new start.
     *   • A burst too short to keep (< `minSpeechMs`) leaves the live edge and
     *     queues nothing. That is a `speech-start` with no `speech-end`, and it
     *     stays that way: inventing a zero-length end would make a cough
     *     indistinguishable from a word.
     */
    private collect(flushed: boolean): VadEvent[] {
        const events: VadEvent[] = [];
        for (let segment = this.engine.nextSegment(); segment !== null; segment = this.engine.nextSegment()) {
            if (!this.inSpeech) events.push({ type: 'speech-start', at: segment.startSample / this.sampleRate });
            events.push(this.toSpeechEnd(segment));
            this.inSpeech = false;
        }

        const live = flushed ? false : this.engine.isSpeech();
        if (live && !this.inSpeech) {
            events.push({ type: 'speech-start', at: this.position });
            this.inSpeech = true;
        } else if (!live && this.inSpeech) {
            // Nothing was queued above, so the engine discarded the burst.
            this.inSpeech = false;
        }
        return events;
    }

    private toSpeechEnd(segment: EngineSegment): SpeechEndEvent {
        const start = segment.startSample / this.sampleRate;
        const duration = segment.samples.length / this.sampleRate;
        return {
            type: 'speech-end',
            start,
            end: start + duration,
            duration,
            startSample: segment.startSample,
            samples: segment.samples,
        };
    }
}

/**
 * Build a detector. Throws when this host has no native engine, or when
 * `options.model` is a manifest id that is not cached yet — gate on
 * `hasVadBackend()` and `available()`.
 */
export function createVad(options: VadOptions = {}): VoiceActivityDetector {
    if (options.engine === undefined) reportVadBackendOnce(loadVadBackend());
    return new VoiceActivityDetector(options);
}
