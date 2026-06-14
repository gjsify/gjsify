import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import streamingClassesTestSuite from './streaming-classes.spec.js';

run({ testSuite, streamingClassesTestSuite });
