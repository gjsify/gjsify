import { run } from '@gjsify/unit';
import logSuite from './log.spec.js';
import nextTickSuite from './next-tick.spec.js';
import platformNamesSuite from './platform-names.spec.js';

run({ logSuite, nextTickSuite, platformNamesSuite });
