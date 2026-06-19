import { run } from '@gjsify/unit';
import indexTestSuite from './index.spec.js';
import spyTestSuite from './spy.spec.js';
import vitestCompatSuite from './vitest-compat.spec.js';

run({ indexTestSuite, spyTestSuite, vitestCompatSuite });
