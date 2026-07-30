// Test entry — routed through `@gjsify/unit`'s `run()` so the suite REPORTS.
//
// Awaiting the spec directly (the previous shape) prints per-test results but
// nothing else: `run()` is what emits the summary line AND sets the process exit
// code. Without it a failing assertion printed a red ❌ and the runner still
// exited 0 — verified by breaking an assertion on purpose — so `gjsify workspace
// @gjsify/webaudio test` reported success on a red suite, and the node-gi
// consumer harness (`node scripts/node-gi-consumer-harness.mjs webaudio`), which
// parses that summary, could only say "ran-no-summary" for node/bun/deno. This
// package's whole claim is that REAL decode + playback work, so a suite that
// cannot fail is the one thing it must not have.
import { run } from '@gjsify/unit';

import testSuiteWebaudio from './webaudio.spec.js';

run({ testSuiteWebaudio });
