import { run } from '@gjsify/unit';

import testSuiteResults from './results.spec.js';
import testSuiteRecognition from './recognition.spec.js';
import testSuiteModels from './models.spec.js';
import testSuiteGstSource from './gst-source.spec.js';
import testSuiteTranscribe from './transcribe.spec.js';
// LAST on purpose: they talk to the real sherpa-onnx engine (silent, file-only)
// and skip without a prebuild or a cached model.
import testSuiteRealEngine from './real-engine.spec.js';
import testSuiteRealTranscribe from './real-transcribe.spec.js';

run({
    testSuiteResults,
    testSuiteRecognition,
    testSuiteModels,
    testSuiteGstSource,
    testSuiteTranscribe,
    testSuiteRealEngine,
    testSuiteRealTranscribe,
});
