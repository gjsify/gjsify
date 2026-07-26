import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import registerSuite from './register.spec.js';
import serializeSuite from './serialize.spec.js';
import channelSuite from './iframe-message-channel.spec.js';
import evalSuite from './eval.spec.js';
import consoleSuite from './console-capture.spec.js';
import domQueriesSuite from './dom-queries.spec.js';

run({ testSuite, registerSuite, serializeSuite, channelSuite, evalSuite, consoleSuite, domQueriesSuite });
