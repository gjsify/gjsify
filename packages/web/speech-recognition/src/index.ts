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

export { DEFAULT_TRANSCRIBE_MODEL } from './model-manifest.js';
export type { RecognitionModelKind } from './model-manifest.js';

export { createSherpaOfflineEngine } from './offline-engine.js';
export type {
    OfflineDecodeOptions,
    OfflineEngine,
    OfflineResult,
    SherpaOfflineEngineConfig,
} from './offline-engine.js';

export { createFakeOfflineEngine } from './fake-offline-engine.js';
export type { FakeOfflineEngine } from './fake-offline-engine.js';

export { TRANSCRIBE_SAMPLE_RATE, transcribe } from './transcribe.js';
export type { TranscribeFile, TranscribeOptions, TranscribeSource, Transcription } from './transcribe.js';
