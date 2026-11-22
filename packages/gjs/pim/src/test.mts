import { run } from '@gjsify/unit';

import caldavSuite from './caldav.spec.js';
import deltaSuite from './delta.spec.js';
import goaSuite from './goa.spec.js';
import optionalSuite from './optional.spec.js';

run({ optionalSuite, caldavSuite, deltaSuite, goaSuite });
