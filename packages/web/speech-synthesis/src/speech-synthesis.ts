// Web Speech API — SpeechSynthesis (the `speechSynthesis` global), driven by Spiel.
// Reference: https://webaudio.github.io/web-speech-api/#tts-section
//
// The utterance QUEUE lives here, not in Spiel: the spec's `pending`, `cancel()` and the
// per-utterance events are defined over a queue the page can observe, and Spiel is fed one
// utterance at a time so its signals always belong to `current`.

import { Event, EventTarget } from '@gjsify/dom-events';

import {
    backendCanSpeak,
    loadSpeechSynthesisBackend,
    reportSpeechBackendOnce,
    type LoadSpeechBackendOptions,
    type SpeechBackend,
} from './backend.js';
import {
    SpeechSynthesisErrorEvent,
    SpeechSynthesisEvent,
    defineEventHandler,
    type SpeechSynthesisErrorCode,
} from './events.js';
import { SPIEL_ERROR, type SpielSpeaker, type SpielUtterance } from './spiel-types.js';
import type { SpeechSynthesisUtterance } from './utterance.js';
import { createVoice, spielVoiceOf, type SpeechSynthesisVoice } from './voice.js';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface SpeechSynthesisOptions extends LoadSpeechBackendOptions {
    /** Constructor of `Spiel.Utterance`; taken from the loaded namespace when omitted. Tests only. */
    createUtterance?: (props: Partial<SpielUtterance>) => SpielUtterance;
}

export class SpeechSynthesis extends EventTarget {
    declare onvoiceschanged: ((ev: Event) => any) | null;

    #options: SpeechSynthesisOptions;
    #queue: SpeechSynthesisUtterance[] = [];
    #current: SpeechSynthesisUtterance | null = null;
    #paused = false;
    #voices: SpeechSynthesisVoice[] = [];
    #backend: SpeechBackend | null = null;
    #loading: Promise<SpeechBackend> | null = null;
    #speakerIds: number[] = [];
    #startedAt = 0;
    #generation = 0;

    constructor(options: SpeechSynthesisOptions = {}) {
        super();
        this.#options = options;
    }

    get speaking(): boolean {
        return this.#current !== null;
    }

    get pending(): boolean {
        return this.#queue.length > 0;
    }

    get paused(): boolean {
        return this.#paused;
    }

    getVoices(): SpeechSynthesisVoice[] {
        // The probe is async (D-Bus activation); the first call kicks it off and
        // `voiceschanged` announces the result, as in browsers.
        void this.#load();
        return this.#voices.slice();
    }

    speak(utterance: SpeechSynthesisUtterance): void {
        this.#queue.push(utterance);
        void this.#load().then((backend) => {
            if (!backendCanSpeak(backend)) {
                reportSpeechBackendOnce(backend);
                this.#failUnavailable();
                return;
            }
            this.#pump();
        });
    }

    cancel(): void {
        this.#queue.length = 0;
        const current = this.#current;
        if (current === null) return;
        // Detach first: Spiel answers cancel() with utterance-canceled, which must not
        // advance the queue a second time.
        this.#current = null;
        this.#paused = false;
        this.#generation++;
        this.#backend?.speaker?.cancel();
        this.#fireError(current, 'canceled');
    }

    pause(): void {
        if (this.#paused || this.#current === null) return;
        this.#paused = true;
        this.#backend?.speaker?.pause();
        this.#fire(this.#current, 'pause');
    }

    resume(): void {
        if (!this.#paused) return;
        this.#paused = false;
        this.#backend?.speaker?.resume();
        if (this.#current) this.#fire(this.#current, 'resume');
    }

    get [Symbol.toStringTag]() {
        return 'SpeechSynthesis';
    }

    #load(): Promise<SpeechBackend> {
        this.#loading ??= loadSpeechSynthesisBackend(this.#options).then((backend) => {
            this.#backend = backend;
            if (backend.status === 'spiel' && backend.speaker) this.#attach(backend.speaker);
            return backend;
        });
        return this.#loading;
    }

    #attach(speaker: SpielSpeaker): void {
        this.#refreshVoices(speaker);
        this.#speakerIds.push(
            speaker.voices.connect('items-changed', () => this.#refreshVoices(speaker)),
            speaker.connect('utterance-started', () => this.#onStarted()),
            speaker.connect('utterance-finished', () => this.#onFinished()),
            speaker.connect('utterance-canceled', () => this.#onSpielCanceled()),
            speaker.connect('utterance-error', (_s: unknown, _u: unknown, err: { code?: number }) =>
                this.#onSpielError(err),
            ),
            speaker.connect('word-started', (_s: unknown, _u: unknown, start: number, end: number) =>
                this.#onBoundary(start, end),
            ),
        );
    }

    #refreshVoices(speaker: SpielSpeaker): void {
        const list: SpeechSynthesisVoice[] = [];
        const model = speaker.voices;
        for (let i = 0; i < model.get_n_items(); i++) {
            const voice = model.get_item(i);
            if (voice) list.push(createVoice(voice, list.length === 0));
        }
        const unchanged =
            list.length === this.#voices.length && list.every((v, i) => v.voiceURI === this.#voices[i].voiceURI);
        this.#voices = list;
        if (!unchanged) this.dispatchEvent(new Event('voiceschanged'));
    }

    #pump(): void {
        if (this.#current !== null || this.#queue.length === 0) return;
        const speaker = this.#backend?.speaker;
        if (!speaker) return;
        const next = this.#queue.shift()!;
        const spiel = this.#toSpiel(next);
        this.#current = next;
        this.#paused = false;
        try {
            speaker.speak(spiel);
        } catch {
            this.#current = null;
            this.#fireError(next, 'synthesis-failed');
            this.#pump();
        }
    }

    #toSpiel(utterance: SpeechSynthesisUtterance): SpielUtterance {
        const voice = spielVoiceOf(utterance.voice);
        const props: Partial<SpielUtterance> = {
            text: utterance.text,
            language: voice?.languages?.[0] ?? utterance.lang ?? '',
            rate: clamp(Number(utterance.rate) || 1, 0.1, 10),
            pitch: clamp(Number.isFinite(Number(utterance.pitch)) ? Number(utterance.pitch) : 1, 0, 2),
            volume: clamp(Number.isFinite(Number(utterance.volume)) ? Number(utterance.volume) : 1, 0, 1),
        };
        if (utterance.lang) props.language = utterance.lang;
        if (voice) props.voice = voice;
        const make = this.#options.createUtterance ?? this.#namespaceUtterance();
        return make(props);
    }

    #namespaceUtterance(): (props: Partial<SpielUtterance>) => SpielUtterance {
        const ns = this.#backend?.namespace;
        if (!ns) throw new Error('Spiel namespace unavailable');
        return (props) => new ns.Utterance(props);
    }

    #onStarted(): void {
        if (!this.#current) return;
        this.#startedAt = Date.now();
        this.#fire(this.#current, 'start');
    }

    #onFinished(): void {
        const done = this.#current;
        if (!done) return;
        this.#current = null;
        this.#fire(done, 'end');
        this.#pump();
    }

    #onSpielCanceled(): void {
        // A cancel we issued already detached `current`; anything else (another client
        // cancelling on the shared speaker) ends the utterance as cancelled.
        const done = this.#current;
        if (!done) return;
        this.#current = null;
        this.#fireError(done, 'canceled');
        this.#pump();
    }

    #onSpielError(err: { code?: number }): void {
        const failed = this.#current;
        if (!failed) return;
        this.#current = null;
        const code: SpeechSynthesisErrorCode =
            err?.code === SPIEL_ERROR.NO_PROVIDERS
                ? 'synthesis-unavailable'
                : err?.code === SPIEL_ERROR.MISCONFIGURED_VOICE
                  ? 'voice-unavailable'
                  : 'synthesis-failed';
        this.#fireError(failed, code);
        this.#pump();
    }

    #onBoundary(start: number, end: number): void {
        if (!this.#current) return;
        this.#fire(this.#current, 'boundary', { charIndex: start, charLength: Math.max(0, end - start), name: 'word' });
    }

    #failUnavailable(): void {
        const queued = this.#queue.splice(0);
        for (const utterance of queued) this.#fireError(utterance, 'synthesis-unavailable');
    }

    #fire(
        utterance: SpeechSynthesisUtterance,
        type: string,
        extra: { charIndex?: number; charLength?: number; name?: string } = {},
    ): void {
        utterance.dispatchEvent(
            new SpeechSynthesisEvent(type, {
                utterance,
                elapsedTime: this.#startedAt ? (Date.now() - this.#startedAt) / 1000 : 0,
                ...extra,
            }),
        );
    }

    #fireError(utterance: SpeechSynthesisUtterance, error: SpeechSynthesisErrorCode): void {
        utterance.dispatchEvent(new SpeechSynthesisErrorEvent('error', { utterance, error }));
    }
}

defineEventHandler(SpeechSynthesis.prototype, 'voiceschanged');
