import { run } from '@gjsify/unit';

import downloadSuite from './download.spec.js';
import manifestSuite from './manifest.spec.js';
import storeSuite from './store.spec.js';

run({ downloadSuite, manifestSuite, storeSuite });
