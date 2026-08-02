// Node-side test entry for @gjsify/cli.
// Built once via `gjsify build src/test.mts --app node --outfile dist/test.node.mjs`,
// run via `node dist/test.node.mjs`.

import { run } from '@gjsify/unit';
import bundlerPickSuite from './bundler-pick.spec.js';
import processStubBannerSuite from './process-stub-banner.spec.js';
import barrelsGenerateSuite from './barrels-generate.spec.js';
import npmOidcSuite from './npm-oidc.spec.js';
import publishDiagnoseSuite from './publish-diagnose.spec.js';
import publishHeadersSuite from './utils/publish-headers.spec.js';
import whoamiCommandSuite from './whoami-command.spec.js';
import installBackendParseSpecSuite from './install-backend-parse-spec.spec.js';
import installTarballCacheSuite from './utils/install-tarball-cache.spec.js';
import installPackumentCacheSuite from './utils/install-packument-cache.spec.js';
import dirLinkSuite from './utils/dir-link.spec.js';
import dlxCacheSuite from './utils/dlx-cache.spec.js';
import installCacheFsSuite from './utils/install-cache-fs.spec.js';
import installLockSuite from './utils/install-lock.spec.js';
import installBackendNativeWarnSuite from './utils/install-backend-native-warn.spec.js';
import detectNativePackagesSuite from './utils/detect-native-packages.spec.js';
import platformCheckSuite from './utils/platform-check.spec.js';
import binShimSuite from './utils/bin-shim.spec.js';
import binShimRuntimeOrderSuite from './bin-shim-runtime-order.spec.js';
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
import aliasPluginSuite from './alias-plugin.spec.js';
import napiNodeAddonSuite from './napi-node-addon.spec.js';
import nodeGiExternalsSuite from './node-gi-externals.spec.js';
import nodeReverseRegistersSuite from './node-reverse-registers.spec.js';
import externalsPluginSuite from './externals-plugin.spec.js';
import affectedClassifierSuite from './affected-classifier.spec.js';
import runStdioSafeSuite from './run-stdio-safe.spec.js';
import runNodeResolveSuite from './run-node-resolve.spec.js';
import trustRegistrySuite from './utils/trust-registry.spec.js';
import npmOtpSuite from './utils/npm-otp.spec.js';
import npmOtpCacheSuite from './utils/npm-otp-cache.spec.js';
import onboardProbeSuite from './utils/onboard-probe.spec.js';
import resolvePluginByNameSuite from './utils/resolve-plugin-by-name.spec.js';
import runtimeSuite from './runtime.spec.js';
import gjsEntryWrapperSuite from './gjs-entry-wrapper.spec.js';
import entryPointsSuite from './entry-points.spec.js';
import pkgJsonSuite from './utils/pkg-json.spec.js';
import rewriteNodeModulesSpecSuite from './rewrite-node-modules-spec.spec.js';
import buildArgsSuite from './build-args.spec.js';
import clearTargetsSuite from './utils/clear-targets.spec.js';
import pinHintSuite from './pin-hint.spec.js';
import configSuite from './config.spec.js';
import libraryOutputSuite from './utils/library-output.spec.js';
import suggestSuite from './utils/suggest.spec.js';
import runtimesSuite from './utils/runtimes.spec.js';
import spawnSuite from './utils/spawn.spec.js';
import win32CommandSuite from './utils/win32-command.spec.js';
import gjsBundleGuardSuite from './utils/gjs-bundle-guard.spec.js';
import nodeBundleGuardSuite from './utils/node-bundle-guard.spec.js';
import unresolvedWorkspaceImportSuite from './unresolved-workspace-import.spec.js';

run({
    bundlerPickSuite,
    processStubBannerSuite,
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
    dirLinkSuite,
    dlxCacheSuite,
    installCacheFsSuite,
    installLockSuite,
    installBackendNativeWarnSuite,
    detectNativePackagesSuite,
    platformCheckSuite,
    binShimSuite,
    binShimRuntimeOrderSuite,
    nodeVersionSuite,
    inlineStaticReadsSuite,
    resolveNpmPackageSuite,
    oxcResolveSuite,
    buildCacheSuite,
    htmlEntrySuite,
    autoGlobalsSuite,
    aliasPluginSuite,
    napiNodeAddonSuite,
    nodeGiExternalsSuite,
    nodeReverseRegistersSuite,
    externalsPluginSuite,
    affectedClassifierSuite,
    runStdioSafeSuite,
    runNodeResolveSuite,
    trustRegistrySuite,
    npmOtpSuite,
    npmOtpCacheSuite,
    onboardProbeSuite,
    resolvePluginByNameSuite,
    runtimeSuite,
    gjsEntryWrapperSuite,
    entryPointsSuite,
    pkgJsonSuite,
    rewriteNodeModulesSpecSuite,
    buildArgsSuite,
    clearTargetsSuite,
    pinHintSuite,
    configSuite,
    libraryOutputSuite,
    suggestSuite,
    runtimesSuite,
    spawnSuite,
    win32CommandSuite,
    gjsBundleGuardSuite,
    nodeBundleGuardSuite,
    unresolvedWorkspaceImportSuite,
});
