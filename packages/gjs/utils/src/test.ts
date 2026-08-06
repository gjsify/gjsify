import { run } from '@gjsify/unit';
import hostOsSuite from './host-os.spec.js';
import hostProcessSuite from './host-process.spec.js';
import logSuite from './log.spec.js';
import nextTickSuite from './next-tick.spec.js';
import platformNamesSuite from './platform-names.spec.js';

run({ hostOsSuite, hostProcessSuite, logSuite, nextTickSuite, platformNamesSuite });
