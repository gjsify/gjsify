import { run } from '@gjsify/unit';

import scenarioSuite from './scenario.spec.js';
import watchdogSuite from './watchdog.spec.js';

run({ watchdogSuite, scenarioSuite });
