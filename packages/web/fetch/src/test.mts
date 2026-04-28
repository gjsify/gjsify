import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/buffer';
import '@gjsify/node-globals/register/url';
import 'fetch/register'; // register fetch/Headers/Request/Response globals on GJS (no-op on Node)
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';

run({ testSuite });