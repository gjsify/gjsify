// Integration-test entry for @gjsify/integration-tls-session.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Covers the deferred Phase 2 acceptance-criteria items 5 + 6 from
// `docs/poc/tls-phase2-session-access.md`:
//   - session resumption round-trip (conn 1 → 'session' → conn 2 reused)
//   - channel-binding bytes via getFinished / getPeerFinished
//     (tls-unique for TLS 1.2, tls-exporter for TLS 1.3)
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import sessionResumptionSuite from './session-resumption.spec.js';
import channelBindingSuite from './channel-binding.spec.js';

run({
    sessionResumptionSuite,
    channelBindingSuite,
});
