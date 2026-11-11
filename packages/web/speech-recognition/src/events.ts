// Web Speech API — SpeechRecognitionEvent / SpeechRecognitionErrorEvent and the `on<event>`
// handler plumbing. Reference: https://webaudio.github.io/web-speech-api/#speechreco-event

import { Event } from '@gjsify/dom-events';

import { SpeechRecognitionResultList } from './results.js';

export interface SpeechRecognitionEventInit {
    resultIndex?: number;
    results?: SpeechRecognitionResultList;
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
}

export class SpeechRecognitionEvent extends Event {
    /** The lowest index in `results` that changed. */
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;

    constructor(type: string, init: SpeechRecognitionEventInit = {}) {
        super(type, init);
        this.resultIndex = init.resultIndex ?? 0;
        this.results = init.results ?? new SpeechRecognitionResultList();
    }

    get [Symbol.toStringTag]() {
        return 'SpeechRecognitionEvent';
    }
}

/** https://webaudio.github.io/web-speech-api/#enumdef-speechrecognitionerrorcode */
export type SpeechRecognitionErrorCode =
    | 'no-speech'
    | 'aborted'
    | 'audio-capture'
    | 'network'
    | 'not-allowed'
    | 'service-not-allowed'
    | 'language-not-supported'
    | 'phrases-not-supported';

export interface SpeechRecognitionErrorEventInit extends SpeechRecognitionEventInit {
    error: SpeechRecognitionErrorCode;
    message?: string;
}

export class SpeechRecognitionErrorEvent extends Event {
    readonly error: SpeechRecognitionErrorCode;
    readonly message: string;

    constructor(type: string, init: SpeechRecognitionErrorEventInit) {
        super(type, init);
        this.error = init.error;
        this.message = init.message ?? '';
    }

    get [Symbol.toStringTag]() {
        return 'SpeechRecognitionErrorEvent';
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
        get(this: EventTarget & Record<symbol, EventListener | null>) {
            return this[slot] ?? null;
        },
        set(this: EventTarget & Record<symbol, EventListener | null>, value: unknown) {
            if (this[slot]) this.removeEventListener(type, this[slot]);
            this[slot] = typeof value === 'function' ? (value as EventListener) : null;
            if (this[slot]) this.addEventListener(type, this[slot]);
        },
    });
}
