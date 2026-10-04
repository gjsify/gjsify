import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
import signalsTestSuite from './signals.spec.js';
run({ testSuite, signalsTestSuite });
