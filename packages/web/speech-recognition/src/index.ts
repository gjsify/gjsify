export { SpeechRecognition } from './recognition.js';
export type { PcmReader, SpeechRecognitionInit } from './recognition.js';

export { SpeechRecognitionErrorEvent, SpeechRecognitionEvent } from './events.js';
export type {
    SpeechRecognitionErrorCode,
    SpeechRecognitionErrorEventInit,
    SpeechRecognitionEventInit,
} from './events.js';

export {
    SpeechRecognitionAlternative,
    SpeechRecognitionPhrase,
    SpeechRecognitionResult,
    SpeechRecognitionResultList,
} from './results.js';

export { available, install, isModelCached, modelCacheDir, uninstall } from './models.js';
export type {
    SpeechRecognitionAvailability,
    SpeechRecognitionInstallOptions,
    SpeechRecognitionOptions,
} from './models.js';

export { DEFAULT_RECOGNITION_MODEL, findRecognitionModel, modelFor, RECOGNITION_MODELS } from './model-manifest.js';
export type { RecognitionModelEntry, RecognitionQuality } from './model-manifest.js';

export { createSherpaEngine, describeRecognitionBackend, hasRecognitionBackend } from './backend.js';
export type { RecognizerDetail, RecognizerEngine, RecognizerFrame, SherpaEngineConfig } from './backend.js';

export { createFakeRecognizerEngine } from './fake-engine.js';
export type { FakeEngineStep, FakeRecognizerEngine } from './fake-engine.js';
