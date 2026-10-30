import { run } from '@gjsify/unit';

import testSuiteCaptureSource from './capture-source.spec.js';
import testSuitePcmSource from './pcm-source.spec.js';

run({ testSuiteCaptureSource, testSuitePcmSource });
