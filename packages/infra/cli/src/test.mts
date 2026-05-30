// Node-side test entry for @gjsify/cli.
// Built once via `gjsify build src/test.mts --app node --outfile dist/test.node.mjs`,
// run via `node dist/test.node.mjs`.

import { run } from '@gjsify/unit';
import bundlerPickSuite from './bundler-pick.spec.js';
import barrelsGenerateSuite from './barrels-generate.spec.js';
import npmOidcSuite from './npm-oidc.spec.js';
import publishDiagnoseSuite from './publish-diagnose.spec.js';
import installBackendParseSpecSuite from './install-backend-parse-spec.spec.js';
import inlineStaticReadsSuite from './inline-static-reads.spec.js';
import resolveNpmPackageSuite from './utils/resolve-npm-package.spec.js';
// `@gjsify/rolldown-plugin-gjsify` has no test runner of its own; its
// `isRegisterSubpath` regression coverage lives here in the CLI's
// `test:node` harness because the CLI already declares the plugin as
// a dependency. The predicate itself is re-exported from the plugin's
// public API.
import autoGlobalsSuite from './auto-globals.spec.js';

run({
    bundlerPickSuite,
    barrelsGenerateSuite,
    npmOidcSuite,
    publishDiagnoseSuite,
    installBackendParseSpecSuite,
    inlineStaticReadsSuite,
    resolveNpmPackageSuite,
    autoGlobalsSuite,
});
