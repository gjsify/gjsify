import { run } from '@gjsify/unit';

import testSuiteSynthesis from './speech-synthesis.spec.js';
// LAST on purpose: it talks to the real libspiel (silent, fakesink) and skips without it.
import testSuiteRealSpiel from './real-spiel.spec.js';

run({ testSuiteSynthesis, testSuiteRealSpiel });
