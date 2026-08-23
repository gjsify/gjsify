import { run } from '@gjsify/unit';

import solidSuite from './adapters/solid.spec.js';
import vueSuite from './adapters/vue.spec.js';
import conformanceSuite from './conformance.spec.js';
import generatedSuite from './generated.spec.js';
import generatorSuite from './generator.spec.js';
import hostSuite from './host.spec.js';
import propsSuite from './props.spec.js';

run({ propsSuite, hostSuite, conformanceSuite, generatorSuite, generatedSuite, solidSuite, vueSuite });
