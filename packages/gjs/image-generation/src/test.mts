import { run } from '@gjsify/unit';

import generatorSuite from './generator.spec.js';
import pngSuite from './png.spec.js';
import sdcppComputeSuite from './sdcpp-compute.spec.js';
import sdcppSuite from './sdcpp.spec.js';

run({ generatorSuite, pngSuite, sdcppSuite, sdcppComputeSuite });
