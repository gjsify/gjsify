// The suites both entries run. `test.mts` is the Node+GJS entry; `test.gjs.mts`
// adds the legs that reach GIO and can therefore only exist on GJS.

import runtimeSurfaceSuite from './runtime-surface.spec.js';
import fileSystemSuite from './filesystem.spec.js';
import pathSuite from './path.spec.js';
import scopeSuite from './scope.spec.js';
import schedulerSuite from './scheduler.spec.js';
import clockSuite from './clock.spec.js';
import streamSuite from './stream.spec.js';
import configEnvSuite from './config-env.spec.js';

export const commonSuites = {
    runtimeSurfaceSuite,
    fileSystemSuite,
    pathSuite,
    scopeSuite,
    schedulerSuite,
    clockSuite,
    streamSuite,
    configEnvSuite,
};
