import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/buffer';
import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import '@gjsify/node-globals/register/structured-clone';
import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
run({ testSuite });
