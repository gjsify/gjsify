// Web Speech API — SpeechSynthesisEvent / SpeechSynthesisErrorEvent and the `on<event>`
// handler plumbing shared by the utterance and the synthesis object.
// Reference: https://webaudio.github.io/web-speech-api/#speechsynthesisevent

import { Event } from '@gjsify/dom-events';

import type { SpeechSynthesisUtterance } from './utterance.js';

export interface SpeechSynthesisEventInit {
    utterance: SpeechSynthesisUtterance;
    charIndex?: number;
    charLength?: number;
    elapsedTime?: number;
    name?: string;
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
}

export class SpeechSynthesisEvent extends Event {
    readonly utterance: SpeechSynthesisUtterance;
    readonly charIndex: number;
    readonly charLength: number;
    readonly elapsedTime: number;
    readonly name: string;

    constructor(type: string, init: SpeechSynthesisEventInit) {
        super(type, init);
        this.utterance = init.utterance;
        this.charIndex = init.charIndex ?? 0;
        this.charLength = init.charLength ?? 0;
        this.elapsedTime = init.elapsedTime ?? 0;
        this.name = init.name ?? '';
    }

    get [Symbol.toStringTag]() {
        return 'SpeechSynthesisEvent';
    }
}

/** https://webaudio.github.io/web-speech-api/#enumdef-speechsynthesiserrorcode */
export type SpeechSynthesisErrorCode =
    | 'canceled'
    | 'interrupted'
    | 'audio-busy'
    | 'audio-hardware'
    | 'network'
    | 'synthesis-unavailable'
    | 'synthesis-failed'
    | 'language-unavailable'
    | 'voice-unavailable'
    | 'text-too-long'
    | 'invalid-argument'
    | 'not-allowed';

export interface SpeechSynthesisErrorEventInit extends SpeechSynthesisEventInit {
    error: SpeechSynthesisErrorCode;
}

export class SpeechSynthesisErrorEvent extends SpeechSynthesisEvent {
    readonly error: SpeechSynthesisErrorCode;

    constructor(type: string, init: SpeechSynthesisErrorEventInit) {
        super(type, init);
        this.error = init.error;
    }

    get [Symbol.toStringTag]() {
        return 'SpeechSynthesisErrorEvent';
    }
}

/**
 * Install an `on<type>` IDL attribute on a prototype: assigning a function adds it as the
 * listener, reassigning replaces it, `null` removes it.
 */
export function defineEventHandler(proto: object, type: string): void {
    const slot = Symbol(`on${type}`);
    Object.defineProperty(proto, `on${type}`, {
        configurable: true,
        enumerable: true,
        get(this: any) {
            return this[slot] ?? null;
        },
        set(this: any, value: unknown) {
            if (this[slot]) this.removeEventListener(type, this[slot]);
            this[slot] = typeof value === 'function' ? value : null;
            if (this[slot]) this.addEventListener(type, this[slot]);
        },
    });
}
