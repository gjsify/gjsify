import { run } from '@gjsify/unit';

import pathTestSuite from './index.spec.js';
import hostFlavourSuite from './host-flavour.spec.js';

run({ pathTestSuite, hostFlavourSuite });
