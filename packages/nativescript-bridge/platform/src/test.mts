import { run } from '@gjsify/unit';

import nativePlatformTestSuite from './index.spec.js';
import gettextFallbackTestSuite from './gettext-fallback.spec.js';

run({ nativePlatformTestSuite, gettextFallbackTestSuite });
