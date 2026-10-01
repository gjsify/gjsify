import '@gjsify/node-globals/register/process';
import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
import terminalFallbackTestSuite from './terminal-fallback.gjs.spec.js';
run({ testSuite, terminalFallbackTestSuite });
