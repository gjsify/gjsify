import { run } from '@gjsify/unit';

import testSuiteResults from './results.spec.js';
import testSuiteRecognition from './recognition.spec.js';
import testSuiteModels from './models.spec.js';
import testSuiteGstSource from './gst-source.spec.js';
// LAST on purpose: it talks to the real sherpa-onnx engine (silent, file-only)
// and skips without a prebuild or a cached model.
import testSuiteRealEngine from './real-engine.spec.js';

run({ testSuiteResults, testSuiteRecognition, testSuiteModels, testSuiteGstSource, testSuiteRealEngine });
