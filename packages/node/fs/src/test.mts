import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/buffer';
import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import { run } from '@gjsify/unit';

import testSuiteCallback from './callback.spec.js';
import testSuiteFileHandle from './file-handle.spec.js';
import testSuitePromise from './promises.spec.js';
import testSuiteSync from './sync.spec.js';
import testSuiteSymlink from './symlink.spec.js';
import testSuiteStat from './stat.spec.js';
import testSuiteNewApis from './new-apis.spec.js';
import testSuiteExtended from './extended.spec.js';

import testSuiteErrors from './errors.spec.js';
import testSuiteStreams from './streams.spec.js';
import testSuiteCp from './cp.spec.js';
import testSuiteDir from './dir.spec.js';

run({testSuiteCallback, testSuiteFileHandle, testSuitePromise, testSuiteSync, testSuiteSymlink, testSuiteStat, testSuiteNewApis, testSuiteExtended, testSuiteErrors, testSuiteStreams, testSuiteCp, testSuiteDir});