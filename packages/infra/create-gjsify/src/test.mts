// Test entry for @gjsify/create-app, built once per target and run on every
// runtime the scaffolder can set a project up FOR (`test:cross-runtime`). Not
// ceremony: `hostRuntime()` in `runtimes.ts` has one branch per runtime, and the
// only way to prove a branch is the one that fires is to execute it there rather
// than fake a global and hope the fake is faithful.

import { run } from '@gjsify/unit';

import runtimesSuite from './runtimes.spec.js';
import selectSuite from './select.spec.js';

run({ runtimesSuite, selectSuite });
