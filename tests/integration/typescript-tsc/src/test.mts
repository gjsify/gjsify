// Integration-test entry for @gjsify/integration-typescript-tsc.
//
// Three layered probes against the `typescript` npm package on GJS:
//
//   1. `ts.version` — the trivial "does the module even load" smoke
//      test. If this fails, the rest is moot.
//
//   2. `ts.createProgram` + `ts.getPreEmitDiagnostics` — the real
//      compiler API. This exercises the parser, scanner, binder, type
//      checker, and diagnostics emitter against an in-memory fixture.
//      If this passes on GJS, then `gjsify check` could in principle
//      run without shelling out to Node.
//
//   3. tsserver handshake — spawn-and-respond against the language
//      server. Validates the LSP-over-stdio surface that editors
//      (VS Code, Helix, Neovim, …) rely on. Currently exercised at
//      the Node level only; GJS-side runs surface what's missing.
//
// Both runtimes (Node + GJS) run the same suite. Differences surface
// as `on('Node.js')` / `on('Gjs')` skip blocks in the spec — gaps
// get documented inline + folded into a future remediation plan.

import { run } from '@gjsify/unit';
import tscVersionSuite from './tsc-version.spec.js';
import tscApiTypecheckSuite from './tsc-api-typecheck.spec.js';
import tsserverHandshakeSuite from './tsserver-handshake.spec.js';

run({
    tscVersionSuite,
    tscApiTypecheckSuite,
    tsserverHandshakeSuite,
});
