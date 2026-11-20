import { run } from '@gjsify/unit';

import nativeFsBridgeTestSuite from './index.spec.js';
import fdTableSuite from './fd-table.spec.js';

run({ nativeFsBridgeTestSuite, fdTableSuite });
