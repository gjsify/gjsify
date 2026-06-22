import { run } from '@gjsify/unit';

import browserCoreSuite from './browser-core.spec.js';
import inspectorSuite from './inspector.spec.js';

run({ browserCoreSuite, inspectorSuite });
