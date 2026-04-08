import '@gjsify/node-globals/register';
import 'fetch/register'; // register fetch/Headers/Request/Response globals on GJS (no-op on Node)
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';

run({ testSuite });