import { run } from '@gjsify/unit';

import caldavSuite from './caldav.spec.js';
import deltaSuite from './delta.spec.js';
import optionalSuite from './optional.spec.js';

run({ optionalSuite, caldavSuite, deltaSuite });
