// Test entry — routed through `@gjsify/unit`'s `run()` so the suite REPORTS.
// Awaiting the spec directly prints per-test results but nothing else: `run()`
// is what emits the summary line AND sets the process exit code, so without it
// a failing assertion still exited 0 (the defect fixed for `@gjsify/webaudio`
// in #872 — this entry had the identical shape).
import { run } from '@gjsify/unit';

import testSuiteGamepad from './gamepad.spec.js';
import testSuiteRegister from './register.spec.js';
// LAST on purpose: the backend suite injects fake `gi://Manette` modules into the
// shared probe cache. It hands the cache back at the end, but ordering it after
// the suites that read the real host keeps that independent of its own cleanup.
import testSuiteBackend from './backend.spec.js';

run({ testSuiteGamepad, testSuiteRegister, testSuiteBackend });
