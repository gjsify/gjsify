import { run } from '@gjsify/unit';

import manifestSuite from './manifest.spec.js';
import storeSuite from './store.spec.js';

run({ manifestSuite, storeSuite });
