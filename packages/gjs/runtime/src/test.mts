import { run } from '@gjsify/unit';
import detectTestSuite from './detect.spec.js';
import indexTestSuite from './index.spec.js';

run({ detectTestSuite, indexTestSuite });
