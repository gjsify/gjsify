import { run } from '@gjsify/unit';

import testSuiteVad from './vad.spec.js';
import testSuiteModels from './models.spec.js';
// LAST on purpose: it talks to the real sherpa-onnx engine (silent, file-only)
// and skips without a prebuild or a cached model.
import testSuiteRealVad from './real-vad.spec.js';

run({ testSuiteVad, testSuiteModels, testSuiteRealVad });
