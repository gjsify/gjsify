import { run } from '@gjsify/unit';
import indexTestSuite from './index.spec.js';
import spyTestSuite from './spy.spec.js';

run({indexTestSuite, spyTestSuite});