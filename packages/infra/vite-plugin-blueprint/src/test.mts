import { run } from '@gjsify/unit';

import pluginSuite from './plugin.spec.js';
import resolveCompilerSuite from './resolve-compiler.spec.js';

run({ pluginSuite, resolveCompilerSuite });
