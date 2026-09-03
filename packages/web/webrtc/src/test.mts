// Test entry — routed through `@gjsify/unit`'s `run()` so the suite REPORTS.
// Awaiting the specs directly prints per-test results but nothing else: `run()`
// is what emits the summary line AND sets the process exit code, so without it
// a failing assertion still exited 0 (the defect fixed for `@gjsify/webaudio`
// in #872 — this entry had the identical shape, and 17 red tests hid under it).
import { run } from '@gjsify/unit';

import testSuiteWebrtc from './webrtc.spec.js';
import testSuiteWpt from './wpt.spec.js';
import testSuiteWptMedia from './wpt-media.spec.js';
import testSuiteRegister from './register.spec.js';

run({ testSuiteWebrtc, testSuiteWpt, testSuiteWptMedia, testSuiteRegister });
