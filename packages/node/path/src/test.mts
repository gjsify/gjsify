import { run } from '@gjsify/unit';

import pathTestSuite from './index.spec.js';
import hostFlavourSuite from './host-flavour.spec.js';
import win32ParitySuite from './win32-parity.spec.js';

run({ pathTestSuite, hostFlavourSuite, win32ParitySuite });
