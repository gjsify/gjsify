// Web Speech API — SpeechSynthesisUtterance
// Reference: https://webaudio.github.io/web-speech-api/#speechsynthesisutterance

import { EventTarget } from '@gjsify/dom-events';

import { defineEventHandler, type SpeechSynthesisErrorEvent, type SpeechSynthesisEvent } from './events.js';
import type { SpeechSynthesisVoice } from './voice.js';

type Handler<E> = ((this: SpeechSynthesisUtterance, ev: E) => any) | null;

export class SpeechSynthesisUtterance extends EventTarget {
    text: string;
    lang = '';
    voice: SpeechSynthesisVoice | null = null;
    volume = 1;
    rate = 1;
    pitch = 1;

    declare onstart: Handler<SpeechSynthesisEvent>;
    declare onend: Handler<SpeechSynthesisEvent>;
    declare onerror: Handler<SpeechSynthesisErrorEvent>;
    declare onpause: Handler<SpeechSynthesisEvent>;
    declare onresume: Handler<SpeechSynthesisEvent>;
    declare onmark: Handler<SpeechSynthesisEvent>;
    declare onboundary: Handler<SpeechSynthesisEvent>;

    constructor(text = '') {
        super();
        this.text = String(text);
    }

    get [Symbol.toStringTag]() {
        return 'SpeechSynthesisUtterance';
    }
}

for (const type of ['start', 'end', 'error', 'pause', 'resume', 'mark', 'boundary']) {
    defineEventHandler(SpeechSynthesisUtterance.prototype, type);
}
