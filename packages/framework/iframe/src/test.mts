
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import serializeSuite from './serialize.spec.js';

run({ testSuite, serializeSuite });
