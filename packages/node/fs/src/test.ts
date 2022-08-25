
import { run } from '@gjsify/unit';
import testSuiteSync from './sync.spec.js';
import testSuitePromise from './promises.spec.js';
import testSuiteCallback from './callback.spec.js';

run({testSuiteSync, testSuitePromise, testSuiteCallback});