import { run } from '@gjsify/unit';

import testSuiteChildProcess from './index.spec.js';
import testSuiteChildProcessParity from './parity.spec.js';

// Subprocess tests are inherently timing-sensitive (fork/exec/IPC + event
// delivery on the GLib main loop). On a saturated CI runner (Fedora 44 is a
// 2-core box running many test bundles in parallel) the loop can be starved
// of CPU for several seconds, so the 5000ms per-test default trips spuriously
// on the event-awaiting spawn tests. 30s of headroom absorbs that without
// weakening any assertion — a genuinely stuck test still fails (and the 120s
// whole-run timeout still bounds the bundle).
run({ testSuiteChildProcess, testSuiteChildProcessParity }, { testTimeout: 30000 });
