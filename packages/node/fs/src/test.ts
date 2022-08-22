
import { run } from '@gjsify/unit';
import testSuiteIndex from './index.spec.js';
import testSuitePromise from './promises.spec.js';

run({testSuiteIndex, testSuitePromise});