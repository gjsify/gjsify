import { run } from '@gjsify/unit';
import logSuite from './log.spec.js';
import nextTickSuite from './next-tick.spec.js';

run({logSuite, nextTickSuite});
