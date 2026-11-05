import { run } from '@gjsify/unit';

import gpuGuardSuite from './gpu-guard.spec.js';
import hintsSuite from './hints.spec.js';
import memorySuite from './memory.spec.js';
import probeBackendsSuite from './probe-backends.spec.js';

run({ hintsSuite, gpuGuardSuite, probeBackendsSuite, memorySuite });
