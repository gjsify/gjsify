import '@gjsify/node-globals/register/process';
import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
run({testSuite});