// Integration-test entry for @gjsify/integration-devtools-cdp.
//
// Drives @gjsify/devtools-cdp's InspectorProtocolClient against a LIVE WebKit
// remote inspector. Opt-in + skip-if-unreachable: a real WebKit inspector isn't
// available headlessly/in CI, so the suite SKIPS (registers one passing test)
// unless GJSIFY_CDP_INSPECTOR_PORT points at a reachable inspector. See README.

import { run } from '@gjsify/unit';
import inspectorProtocolSuite from './inspector-protocol.spec.js';

run({
    inspectorProtocolSuite,
});
