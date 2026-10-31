export { createVad, VoiceActivityDetector } from './vad.js';
export type { SpeechEndEvent, SpeechStartEvent, VadEvent, VadOptions } from './vad.js';

export {
    available,
    install,
    installedModels,
    listModels,
    modelCacheDir,
    modelPath,
    resolveModel,
    uninstall,
} from './models.js';
export type { InstallOptions, InstallProgress, VadModelAvailability } from './models.js';

export { DEFAULT_VAD_MODEL, findVadModel, requireVadModel, VAD_MODELS } from './model-manifest.js';
export type { VadModelEntry } from './model-manifest.js';

export {
    createSherpaVadEngine,
    describeVadBackend,
    hasVadBackend,
    loadVadBackend,
    reportVadBackendOnce,
    _resetVadBackendCache,
} from './backend.js';
export type { EngineSegment, LoadVadBackendOptions, VadBackend, VadBackendStatus, VadEngine } from './backend.js';

export { inferFormat, toFloatSamples } from './pcm.js';
export type { PcmChunk, PcmFormat, PcmSourceLike, VadInput } from './pcm.js';

export { createFakeVadEngine } from './fake-vad.js';
export type { FakeVadEngine } from './fake-vad.js';
