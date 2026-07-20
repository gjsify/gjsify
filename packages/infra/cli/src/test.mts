// Node-side test entry for @gjsify/cli.
// Built once via `gjsify build src/test.mts --app node --outfile dist/test.node.mjs`,
// run via `node dist/test.node.mjs`.

import { run } from '@gjsify/unit';
import bundlerPickSuite from './bundler-pick.spec.js';
import barrelsGenerateSuite from './barrels-generate.spec.js';
import npmOidcSuite from './npm-oidc.spec.js';
import publishDiagnoseSuite from './publish-diagnose.spec.js';
import publishHeadersSuite from './utils/publish-headers.spec.js';
import whoamiCommandSuite from './whoami-command.spec.js';
import installBackendParseSpecSuite from './install-backend-parse-spec.spec.js';
import installTarballCacheSuite from './utils/install-tarball-cache.spec.js';
import installPackumentCacheSuite from './utils/install-packument-cache.spec.js';
import installCacheFsSuite from './utils/install-cache-fs.spec.js';
import installLockSuite from './utils/install-lock.spec.js';
import nodeVersionSuite from './utils/node-version.spec.js';
import authNpmrcSuite from './utils/auth-npmrc.spec.js';
import promptKeySuite from './utils/prompt.spec.js';
import inlineStaticReadsSuite from './inline-static-reads.spec.js';
import resolveNpmPackageSuite from './utils/resolve-npm-package.spec.js';
import oxcResolveSuite from './utils/oxc-resolve.spec.js';
import buildCacheSuite from './utils/build-cache.spec.js';
import htmlEntrySuite from './utils/html-entry.spec.js';
// `@gjsify/rolldown-plugin-gjsify` has no test runner of its own; its
// `isRegisterSubpath` regression coverage lives here in the CLI's
// `test:node` harness because the CLI already declares the plugin as
// a dependency. The predicate itself is re-exported from the plugin's
// public API.
import autoGlobalsSuite from './auto-globals.spec.js';
import nodeGiExternalsSuite from './node-gi-externals.spec.js';
import nodeReverseRegistersSuite from './node-reverse-registers.spec.js';
import externalsPluginSuite from './externals-plugin.spec.js';
import affectedClassifierSuite from './affected-classifier.spec.js';
import runStdioSafeSuite from './run-stdio-safe.spec.js';
import trustRegistrySuite from './utils/trust-registry.spec.js';
import npmOtpSuite from './utils/npm-otp.spec.js';
import npmOtpCacheSuite from './utils/npm-otp-cache.spec.js';
import onboardProbeSuite from './utils/onboard-probe.spec.js';
import resolvePluginByNameSuite from './utils/resolve-plugin-by-name.spec.js';
import runtimeSuite from './runtime.spec.js';
import gjsEntryWrapperSuite from './gjs-entry-wrapper.spec.js';
import configSuite from './config.spec.js';
import libraryOutputSuite from './utils/library-output.spec.js';
import suggestSuite from './utils/suggest.spec.js';
import runtimesSuite from './utils/runtimes.spec.js';

run({
    bundlerPickSuite,
    barrelsGenerateSuite,
    npmOidcSuite,
    publishDiagnoseSuite,
    publishHeadersSuite,
    whoamiCommandSuite,
    installBackendParseSpecSuite,
    installTarballCacheSuite,
    installPackumentCacheSuite,
    authNpmrcSuite,
    promptKeySuite,
    installCacheFsSuite,
    installLockSuite,
    nodeVersionSuite,
    inlineStaticReadsSuite,
    resolveNpmPackageSuite,
    oxcResolveSuite,
    buildCacheSuite,
    htmlEntrySuite,
    autoGlobalsSuite,
    nodeGiExternalsSuite,
    nodeReverseRegistersSuite,
    externalsPluginSuite,
    affectedClassifierSuite,
    runStdioSafeSuite,
    trustRegistrySuite,
    npmOtpSuite,
    npmOtpCacheSuite,
    onboardProbeSuite,
    resolvePluginByNameSuite,
    runtimeSuite,
    gjsEntryWrapperSuite,
    configSuite,
    libraryOutputSuite,
    suggestSuite,
    runtimesSuite,
});
