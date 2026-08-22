import { run } from '@gjsify/unit';

import solidSuite from './adapters/solid.spec.js';
import conformanceSuite from './conformance.spec.js';
import hostSuite from './host.spec.js';
import propsSuite from './props.spec.js';

run({ propsSuite, hostSuite, conformanceSuite, solidSuite });
