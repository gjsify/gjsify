// Web Speech API — SpeechRecognition on a local streaming recognizer (ADR 0127).
// Reference: https://webaudio.github.io/web-speech-api/#speechreco-section
//
// One `start()` is one SESSION: capture → (VAD, recognizer) → events. The VAD
// (`@gjsify/vad`, 300 ms of silence) is what makes the finals arrive inside the
// 500 ms budget — the model's own endpoint rules wait 1.2–2.4 s — and the model's
// endpoint stays as the fallback for a host that has no VAD model cached.
//
// Where this deliberately differs from the spec text:
//   • `processLocally` is always `true`, and assigning `false` throws (ADR decision 3);
//     the spec default is `false`. Nothing here talks to a recognition service.
//   • `grammars` and `serviceURI` are not implemented (ADR decision 1).
//   • `phrases` is a plain array, not an ObservableArray, and is read at `start()`.
//   • `start(track)` is validated but cannot be consumed yet: error `audio-capture`.

import { type Event, EventTarget } from '@gjsify/dom-events';
import { openPcmSource } from '@gjsify/media-capture';
import {
    available as vadAvailable,
    createVad,
    toFloatSamples,
    type PcmFormat,
    type VoiceActivityDetector,
} from '@gjsify/vad';

import { createSherpaEngine, hasRecognitionBackend, type RecognizerEngine } from './backend.js';
import {
    defineEventHandler,
    SpeechRecognitionErrorEvent,
    SpeechRecognitionEvent,
    type SpeechRecognitionErrorCode,
} from './events.js';
import { modelFor, type RecognitionModelEntry, type RecognitionQuality } from './model-manifest.js';
import {
    available as availableImpl,
    install as installImpl,
    isModelCached,
    resolveRecognitionModel,
    type SpeechRecognitionAvailability,
    type SpeechRecognitionInstallOptions,
    type SpeechRecognitionOptions,
} from './models.js';
import {
    namedError,
    SpeechRecognitionAlternative,
    type SpeechRecognitionPhrase,
    SpeechRecognitionResult,
    SpeechRecognitionResultList,
} from './results.js';

/** As much of `@gjsify/media-capture`'s `PcmSource` as a session reads. */
export interface PcmReader {
    readonly sampleRate?: number;
    readonly format?: PcmFormat;
    start?(): void;
    read(): Promise<Uint8Array | Int16Array | Float32Array | null>;
    stop(): void;
}

/** Replace the parts of a session that touch hardware or a model. Tests, and apps with their own audio. */
export interface SpeechRecognitionInit {
    /** The engine for `model`. Default: sherpa-onnx on the cached files. */
    engine?: (model: RecognitionModelEntry) => RecognizerEngine;
    /** The detector, or `null` for none. Default: Silero when its model is cached. */
    vad?: () => VoiceActivityDetector | null;
    /** The audio. Default: the default microphone at 16 kHz mono through `@gjsify/media-capture`. */
    source?: () => PcmReader;
}

const EVENTS = [
    'audiostart',
    'soundstart',
    'speechstart',
    'speechend',
    'soundend',
    'audioend',
    'result',
    'nomatch',
    'error',
    'start',
    'end',
] as const;

const SAMPLE_RATE = 16000;

function systemLanguage(): string {
    try {
        return new Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
        return 'en-US';
    }
}

function mean(values: number[]): number {
    return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- on<event> are installed on the prototype by defineEventHandler
export class SpeechRecognition extends EventTarget {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    unspokenPunctuation = false;
    phrases: SpeechRecognitionPhrase[] = [];

    #init: SpeechRecognitionInit;
    #active = false;
    #stopRequested = false;
    #aborted = false;
    #source: PcmReader | null = null;

    constructor(init: SpeechRecognitionInit = {}) {
        super();
        this.#init = init;
    }

    get processLocally(): boolean {
        return true;
    }

    set processLocally(value: boolean) {
        if (!value) {
            throw namedError(
                'SpeechRecognition.processLocally cannot be false: gjsify has no recognition service to reach',
                'NotSupportedError',
            );
        }
    }

    static available(options: SpeechRecognitionOptions): Promise<SpeechRecognitionAvailability> {
        return availableImpl(options);
    }

    static install(options: SpeechRecognitionInstallOptions): Promise<boolean> {
        return installImpl(options);
    }

    start(track?: unknown): void {
        if (this.#active) throw namedError('SpeechRecognition has already started', 'InvalidStateError');
        const t = track as { kind?: string; readyState?: string } | undefined;
        if (t !== undefined && (t.kind !== 'audio' || t.readyState !== 'live')) {
            throw namedError('start(track) needs a live audio MediaStreamTrack', 'InvalidStateError');
        }
        this.#active = true;
        this.#stopRequested = false;
        this.#aborted = false;
        const snapshot = {
            lang: this.lang || systemLanguage(),
            quality: 'command' as RecognitionQuality,
            continuous: this.continuous,
            interim: this.interimResults,
            phrases: this.phrases.length,
            track: t !== undefined,
        };
        queueMicrotask(() => {
            void this.#run(snapshot).catch((error) => {
                this.#fail('audio-capture', error instanceof Error ? error.message : String(error));
            });
        });
    }

    /** Stop capturing; what was heard so far is still recognized and delivered. */
    stop(): void {
        if (!this.#active || this.#stopRequested) return;
        this.#stopRequested = true;
        this.#source?.stop();
    }

    /** Stop capturing and discard everything; only `end` follows. */
    abort(): void {
        if (!this.#active || this.#aborted) return;
        this.#stopRequested = true;
        this.#aborted = true;
        this.#source?.stop();
    }

    #emit(type: string): void {
        this.dispatchEvent(new SpeechRecognitionEvent(type));
    }

    #fail(code: SpeechRecognitionErrorCode, message: string): void {
        this.dispatchEvent(new SpeechRecognitionErrorEvent('error', { error: code, message }));
        if (this.#active) {
            this.#active = false;
            this.#emit('end');
        }
    }

    async #run(opts: {
        lang: string;
        quality: RecognitionQuality;
        continuous: boolean;
        interim: boolean;
        phrases: number;
        track: boolean;
    }): Promise<void> {
        const model = modelFor(opts.lang, opts.quality);
        if (model === undefined) {
            return this.#fail(
                'language-not-supported',
                `No recognition model for '${opts.lang}' at quality '${opts.quality}'`,
            );
        }
        if (opts.phrases > 0 && !model.hotwords) {
            return this.#fail('phrases-not-supported', `Model '${model.id}' cannot be biased with phrases`);
        }
        if (opts.track) {
            return this.#fail(
                'audio-capture',
                'start(track) is not supported yet — call start() for the default microphone',
            );
        }
        let engine: RecognizerEngine;
        if (this.#init.engine !== undefined) {
            engine = this.#init.engine(model);
        } else {
            if (!hasRecognitionBackend() || !isModelCached(model)) {
                return this.#fail(
                    'service-not-allowed',
                    `Model '${model.id}' is not usable here — check SpeechRecognition.available() and install() it`,
                );
            }
            const files = resolveRecognitionModel(model);
            engine = createSherpaEngine({
                encoder: files[model.encoder],
                decoder: files[model.decoder],
                joiner: files[model.joiner],
                tokens: files[model.tokens],
                sampleRate: model.sampleRate,
            });
        }
        try {
            engine.open();
        } catch (error) {
            return this.#fail(
                'service-not-allowed',
                `The recognizer could not load: ${error instanceof Error ? error.message : error}`,
            );
        }

        const vad = this.#openVad();
        let source: PcmReader;
        try {
            source =
                this.#init.source?.() ?? (openPcmSource({ sampleRate: SAMPLE_RATE, format: 'S16LE' }) as PcmReader);
            source.start?.();
        } catch (error) {
            engine.close();
            vad?.close();
            return this.#fail('audio-capture', error instanceof Error ? error.message : String(error));
        }
        this.#source = source;
        // A stop()/abort() that raced the setup above found no source to stop.
        if (this.#stopRequested) source.stop();

        this.#emit('start');
        try {
            await this.#session(opts, engine, vad, source);
        } catch (error) {
            // Before `end`: an error dispatched after it belongs to no session.
            this.dispatchEvent(
                new SpeechRecognitionErrorEvent('error', {
                    error: 'audio-capture',
                    message: error instanceof Error ? error.message : String(error),
                }),
            );
        } finally {
            this.#source = null;
            source.stop();
            vad?.close();
            engine.close();
            this.#active = false;
            this.#emit('end');
        }
    }

    #openVad(): VoiceActivityDetector | null {
        try {
            if (this.#init.vad !== undefined) {
                const vad = this.#init.vad();
                vad?.open();
                return vad;
            }
            if (vadAvailable() !== 'available') return null;
            const vad = createVad({ minSilenceMs: 300 });
            vad.open();
            return vad;
        } catch {
            return null;
        }
    }

    async #session(
        opts: { continuous: boolean; interim: boolean },
        engine: RecognizerEngine,
        vad: VoiceActivityDetector | null,
        source: PcmReader,
    ): Promise<void> {
        const rate = source.sampleRate ?? SAMPLE_RATE;
        const finals: SpeechRecognitionResult[] = [];
        let audioStarted = false;
        let inSound = false;
        let lastInterim = '';
        let position = 0; // samples consumed
        let utteranceStart = 0; // samples consumed when the current utterance began
        let done = false;

        const list = (interim?: SpeechRecognitionResult) =>
            new SpeechRecognitionResultList(interim ? [...finals, interim] : finals);
        const spaced = (text: string, index: number) => (index > 0 ? ` ${text}` : text);

        const beginSound = () => {
            if (inSound) return;
            inSound = true;
            this.#emit('soundstart');
            this.#emit('speechstart');
        };

        const finalize = (flushed: boolean, endpointText: string) => {
            const text = (flushed ? engine.flushTail().text : endpointText).trim();
            const detail = engine.detail();
            engine.reset();
            const startedHere = inSound;
            if (inSound) {
                inSound = false;
                this.#emit('speechend');
                this.#emit('soundend');
            }
            lastInterim = '';
            const offset = utteranceStart / rate;
            utteranceStart = position;
            if (text === '') {
                if (startedHere) {
                    this.#emit('nomatch');
                    if (!opts.continuous) done = true;
                }
                return;
            }
            const probs = detail.logProbs.map((p) => Math.exp(p));
            const times = detail.timestamps;
            const result = new SpeechRecognitionResult({
                alternatives: [new SpeechRecognitionAlternative(spaced(text, finals.length), mean(probs))],
                isFinal: true,
                speechStartTime: offset + (times.length > 0 ? times[0] : 0),
                speechEndTime: times.length > 0 ? offset + times[times.length - 1] : position / rate,
            });
            finals.push(result);
            this.dispatchEvent(
                new SpeechRecognitionEvent('result', { resultIndex: finals.length - 1, results: list() }),
            );
            if (!opts.continuous) done = true;
        };

        const sawSpeechEnd = (events: { type: string }[]) => events.some((e) => e.type === 'speech-end');
        const sawSpeechStart = (events: { type: string }[]) => events.some((e) => e.type === 'speech-start');

        while (!done) {
            const chunk = await source.read();
            if (chunk === null || this.#aborted) break;
            if (!audioStarted) {
                audioStarted = true;
                this.#emit('audiostart');
            }
            const samples = toFloatSamples(chunk, source.format ?? 'S16LE');
            position += samples.length;
            const vadEvents = vad ? vad.accept(samples) : [];
            const frame = engine.accept(samples);

            if (sawSpeechStart(vadEvents) || frame.text !== '') beginSound();
            if (frame.text !== '' && frame.text !== lastInterim && opts.interim && !frame.endpoint) {
                lastInterim = frame.text;
                const interim = new SpeechRecognitionResult({
                    alternatives: [new SpeechRecognitionAlternative(spaced(frame.text.trim(), finals.length), 0)],
                    isFinal: false,
                    speechStartTime: utteranceStart / rate,
                    speechEndTime: position / rate,
                });
                this.dispatchEvent(
                    new SpeechRecognitionEvent('result', { resultIndex: finals.length, results: list(interim) }),
                );
            }
            if (sawSpeechEnd(vadEvents)) finalize(true, frame.text);
            else if (frame.endpoint) finalize(false, frame.text);
        }

        if (!this.#aborted) {
            // Capture ended (stop(), or a file ran out): whatever is pending is still an utterance.
            if (!done && audioStarted) {
                if (vad) vad.flush();
                const pending = engine.flushTail().text.trim();
                if (inSound || pending !== '') finalize(false, pending);
            }
            if (finals.length === 0) {
                this.dispatchEvent(new SpeechRecognitionErrorEvent('error', { error: 'no-speech', message: '' }));
            }
        }
        if (audioStarted) this.#emit('audioend');
    }
}

type Handler = ((event: Event) => void) | null;

/** The `on<event>` IDL attributes, installed on the prototype by {@link defineEventHandler}. */
export interface SpeechRecognition {
    onaudiostart: Handler;
    onsoundstart: Handler;
    onspeechstart: Handler;
    onspeechend: Handler;
    onsoundend: Handler;
    onaudioend: Handler;
    onresult: Handler;
    onnomatch: Handler;
    onerror: Handler;
    onstart: Handler;
    onend: Handler;
}

for (const type of EVENTS) defineEventHandler(SpeechRecognition.prototype, type);
