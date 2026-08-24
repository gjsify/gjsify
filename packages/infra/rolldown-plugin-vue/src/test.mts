import { run } from '@gjsify/unit';

import compileSuite from './compile.spec.js';
import pluginSuite from './plugin.spec.js';

run({ compileSuite, pluginSuite });
