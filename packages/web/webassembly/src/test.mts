import '@gjsify/node-globals/register';
import '@gjsify/webassembly/register';
import { run } from '@gjsify/unit';

import promiseSuite from './promise.spec.js';

run({
    Promise: promiseSuite,
});
