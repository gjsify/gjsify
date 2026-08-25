import { run } from '@gjsify/unit';
import indexTestSuite from './index.spec.js';
import spyTestSuite from './spy.spec.js';
import vitestCompatSuite from './vitest-compat.spec.js';
import itFailingSuite from './it-failing.spec.js';
import callbackAssertionSuite from './callback-assertion.spec.js';
import capabilitiesSuite from './capabilities.spec.js';
import axisLedgerSuite from './axis-ledger.spec.js';
import failureRecapSuite from './failure-recap.spec.js';
import exitCodeSuite from './exit-code.spec.js';

run(
    {
        indexTestSuite,
        spyTestSuite,
        vitestCompatSuite,
        itFailingSuite,
        callbackAssertionSuite,
        capabilitiesSuite,
        axisLedgerSuite,
        failureRecapSuite,
        exitCodeSuite,
    },
    {
        // The runner's own legs are the one place this must hold end-to-end: every
        // runtime this entry is launched on has gates in `axis-ledger.spec.ts`, so a
        // leg that exercises none of them has stopped running the ledger's own
        // coverage — exactly the silence `requireAxes` refuses to exit 0 on.
        requireAxes: ['Gjs', 'Node.js', 'Bun', 'Deno'],
    },
);
