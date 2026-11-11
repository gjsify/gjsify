import { run } from '@gjsify/unit';

import catalogSuite from './catalog/catalog.spec.js';
import downloadSuite from './download.spec.js';
import manifestSuite from './manifest.spec.js';
import storeSuite from './store.spec.js';

run({ catalogSuite, downloadSuite, manifestSuite, storeSuite });
