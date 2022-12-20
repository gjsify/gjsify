import { run } from '@gjsify/unit';
import processSuite from './process.spec.js';
import ttdSuite from './tty.spec.js';

run({ttdSuite, processSuite});