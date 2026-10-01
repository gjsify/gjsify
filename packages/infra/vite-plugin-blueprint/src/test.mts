import { run } from '@gjsify/unit';

import pluginSuite from './plugin.spec.js';
import typedExportsSuite from './typed-exports.spec.js';

run({ pluginSuite, typedExportsSuite });
