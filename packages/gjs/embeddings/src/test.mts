import { run } from '@gjsify/unit';

import embedderSuite from './embedder.spec.js';
import llamaSuite from './llama.spec.js';
import vectorsSuite from './vectors.spec.js';

run({ embedderSuite, llamaSuite, vectorsSuite });
