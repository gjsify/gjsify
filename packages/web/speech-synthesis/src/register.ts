// Web Speech synthesis API — global registration for GJS
// Side-effect module: import '@gjsify/speech-synthesis/register'

import { SpeechSynthesisErrorEvent, SpeechSynthesisEvent } from './events.js';
import { SpeechSynthesis } from './speech-synthesis.js';
import { SpeechSynthesisUtterance } from './utterance.js';
import { SpeechSynthesisVoice } from './voice.js';

interface _SpeechGlobals {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesis?: typeof SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
    SpeechSynthesisVoice?: typeof SpeechSynthesisVoice;
    SpeechSynthesisEvent?: typeof SpeechSynthesisEvent;
    SpeechSynthesisErrorEvent?: typeof SpeechSynthesisErrorEvent;
}

const g = globalThis as unknown as _SpeechGlobals;

// Never over a runtime that has its own (browser: "native").
if (typeof g.speechSynthesis === 'undefined') {
    g.speechSynthesis = new SpeechSynthesis();
    g.SpeechSynthesis = SpeechSynthesis;
    g.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
    g.SpeechSynthesisVoice = SpeechSynthesisVoice;
    g.SpeechSynthesisEvent = SpeechSynthesisEvent;
    g.SpeechSynthesisErrorEvent = SpeechSynthesisErrorEvent;
}
