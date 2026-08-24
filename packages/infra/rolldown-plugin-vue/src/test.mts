import { run } from '@gjsify/unit';

import compileSuite from './compile.spec.js';
import pluginSuite from './plugin.spec.js';
import sourceMapSuite from './source-map.spec.js';

run({ compileSuite, pluginSuite, sourceMapSuite });
