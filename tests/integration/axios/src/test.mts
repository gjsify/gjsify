import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';


import basicSuite       from './basic.spec.js';
import headersSuite     from './headers.spec.js';
import timeoutSuite     from './timeout.spec.js';
import redirectsSuite   from './redirects.spec.js';
import compressionSuite from './compression.spec.js';
import streamsSuite     from './streams.spec.js';
import abortSuite       from './abort.spec.js';

run({ basicSuite, headersSuite, timeoutSuite, redirectsSuite, compressionSuite, streamsSuite, abortSuite });
