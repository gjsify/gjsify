import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
import gjsSuite from './http2.gjs.spec.js';
import nativeDispatchSuite from './http2-native-dispatch.gjs.spec.js';
run({ testSuite, gjsSuite, nativeDispatchSuite });
