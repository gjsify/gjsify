// Web Speech recognition API — global registration for GJS
// Side-effect module: import '@gjsify/speech-recognition/register'

import { SpeechRecognitionErrorEvent, SpeechRecognitionEvent } from './events.js';
import { SpeechRecognition } from './recognition.js';
import {
    SpeechRecognitionAlternative,
    SpeechRecognitionPhrase,
    SpeechRecognitionResult,
    SpeechRecognitionResultList,
} from './results.js';

interface _RecognitionGlobals {
    SpeechRecognition?: typeof SpeechRecognition;
    SpeechRecognitionEvent?: typeof SpeechRecognitionEvent;
    SpeechRecognitionErrorEvent?: typeof SpeechRecognitionErrorEvent;
    SpeechRecognitionResultList?: typeof SpeechRecognitionResultList;
    SpeechRecognitionResult?: typeof SpeechRecognitionResult;
    SpeechRecognitionAlternative?: typeof SpeechRecognitionAlternative;
    SpeechRecognitionPhrase?: typeof SpeechRecognitionPhrase;
}

const g = globalThis as unknown as _RecognitionGlobals;

// Never over a runtime that has its own (browser: "native").
if (typeof g.SpeechRecognition === 'undefined') {
    g.SpeechRecognition = SpeechRecognition;
    g.SpeechRecognitionEvent = SpeechRecognitionEvent;
    g.SpeechRecognitionErrorEvent = SpeechRecognitionErrorEvent;
    g.SpeechRecognitionResultList = SpeechRecognitionResultList;
    g.SpeechRecognitionResult = SpeechRecognitionResult;
    g.SpeechRecognitionAlternative = SpeechRecognitionAlternative;
    g.SpeechRecognitionPhrase = SpeechRecognitionPhrase;
}
