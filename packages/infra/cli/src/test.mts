// Node-side test entry for @gjsify/cli.
// Built once via `gjsify build src/test.mts --app node --outfile dist/test.node.mjs`,
// run via `node dist/test.node.mjs`.

import { run } from '@gjsify/unit';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bundlerPickSuite from './bundler-pick.spec.js';
import reflectionTransformOrderSuite from './reflection-transform-order.spec.js';
import cliFailSuite from './cli-fail.spec.js';
import shipPlanSuite from './utils/ship/plan.spec.js';
import shipLayoutSuite from './utils/ship/layout.spec.js';
import shipPayloadSuite from './utils/ship/payload.spec.js';
import shipLauncherSuite from './utils/ship/launcher.spec.js';
import shipSettingsSuite from './utils/ship/settings.spec.js';
import shipLocalesSuite from './utils/ship/discover-locales.spec.js';
import msgfmtMergeSuite from './utils/msgfmt-merge.spec.js';
import shipTypelibsSuite from './utils/ship/discover-typelibs.spec.js';
import shipMimeSuite from './utils/ship/mime.spec.js';
import shipLicenseSuite from './utils/ship/discover-license.spec.js';
import shipDependsSuite from './utils/ship/depends.spec.js';
import shipNodeRuntimeSuite from './utils/ship/node-runtime.spec.js';
import shipAppRuntimeSuite from './utils/ship/app-runtime.spec.js';
import shipFlatpakSuite from './utils/ship/flatpak.spec.js';
import installProvenanceSuite from './utils/install-provenance.spec.js';
import shipPlistSuite from './utils/ship/plist.spec.js';
import shipArchivesSuite from './utils/ship/archives.spec.js';
import shipPackersSuite from './utils/ship/packers.spec.js';
import shipSigningSuite from './utils/ship/signing.spec.js';
import installProjectEngineSuite from './commands/install-project-engine.spec.js';
import giRuntimePathsBannerSuite from './gi-runtime-paths-banner.spec.js';
import processStubBannerSuite from './process-stub-banner.spec.js';
import barrelsGenerateSuite from './barrels-generate.spec.js';
import npmOidcSuite from './npm-oidc.spec.js';
import publishDiagnoseSuite from './publish-diagnose.spec.js';
import publishHeadersSuite from './utils/publish-headers.spec.js';
import cliRuntimeClosureSuite from './utils/cli-runtime-closure.spec.js';
import whoamiCommandSuite from './whoami-command.spec.js';
import installBackendParseSpecSuite from './install-backend-parse-spec.spec.js';
import installTarballCacheSuite from './utils/install-tarball-cache.spec.js';
import installPackumentCacheSuite from './utils/install-packument-cache.spec.js';
import dirLinkSuite from './utils/dir-link.spec.js';
import resolveBinOnPathSuite from './utils/resolve-bin-on-path.spec.js';
import showcasePreflightSuite from './commands/showcase-preflight.spec.js';
import checkSystemDepsSuite from './utils/check-system-deps.spec.js';
import dlxCacheSuite from './utils/dlx-cache.spec.js';
import installCacheFsSuite from './utils/install-cache-fs.spec.js';
import installLockSuite from './utils/install-lock.spec.js';
import installBackendNativeWarnSuite from './utils/install-backend-native-warn.spec.js';
import installOptionalEdgesSuite from './utils/install-optional-edges.spec.js';
import detectNativePackagesSuite from './utils/detect-native-packages.spec.js';
import giSearchPathSuite from './utils/gi-search-path.spec.js';
import systemGiSuite from './utils/system-gi.spec.js';
import giTypelibSuite from './utils/gi-typelib.spec.js';
import platformCheckSuite from './utils/platform-check.spec.js';
import binShimSuite from './utils/bin-shim.spec.js';
import gjsifyShimSuite from './utils/gjsify-shim.spec.js';
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
import onboardDiscoverySuite from './utils/onboard-discovery.spec.js';
import promptOutputSuite from './utils/prompt-output.spec.js';
import resolvePluginByNameSuite from './utils/resolve-plugin-by-name.spec.js';
import runtimeSuite from './runtime.spec.js';
import gjsEntryWrapperSuite from './gjs-entry-wrapper.spec.js';
import entryPointsSuite from './entry-points.spec.js';
import pkgJsonSuite from './utils/pkg-json.spec.js';
import rewriteNodeModulesSpecSuite from './rewrite-node-modules-spec.spec.js';
import buildArgsSuite from './build-args.spec.js';
import clearTargetsSuite from './utils/clear-targets.spec.js';
import copyTargetsSuite from './utils/copy-targets.spec.js';
import pinHintSuite from './pin-hint.spec.js';
import configSuite from './config.spec.js';
import libraryOutputSuite from './utils/library-output.spec.js';
import suggestSuite from './utils/suggest.spec.js';
import runtimesSuite from './utils/runtimes.spec.js';
import devPlanSuite from './utils/dev-plan.spec.js';
import watchLoopSuite from './utils/watch-loop.spec.js';
import spawnSuite from './utils/spawn.spec.js';
import win32CommandSuite from './utils/win32-command.spec.js';
import gjsBundleGuardSuite from './utils/gjs-bundle-guard.spec.js';
import gjsSourceEscapeSuite from './utils/gjs-source-escape.spec.js';
import jsxConfigSuite from './utils/jsx-config.spec.js';
import nodeBundleGuardSuite from './utils/node-bundle-guard.spec.js';
import prunePrefixSuite from './utils/prune-prefix.spec.js';
import unresolvedWorkspaceImportSuite from './unresolved-workspace-import.spec.js';
import platformResolveSuite from './platform-resolve.spec.js';
import reactNativeAliasSuite from './react-native-alias.spec.js';
import reactNativeGateSuite from './react-native-gate.spec.js';

// ---------------------------------------------------------------------------
// Capability-gated skips
// ---------------------------------------------------------------------------
//
// A few rows assert behaviour that needs something the HOST may not be able to
// do. They are not platform-specific tests and they are not broken — they
// simply cannot execute where the capability is absent, and failing there says
// nothing about the code.
//
// Measured on a win32 x64 VM: this suite ran 1703 tests with exactly these six
// failing, each for a machine reason. Left as failures they are six results a
// Windows contributor has to learn to ignore — which is how a real regression
// gets ignored along with them. As skips, with the reason printed and counted,
// the suite is green and the gap is stated rather than remembered.
//
// PROBED, NOT ASSUMED. `process.platform === 'win32'` is the wrong gate for the
// symlink rows: Windows CAN create file symlinks under Developer Mode or an
// elevated shell, and gating on the platform name would silently drop coverage
// on a host that has the capability. Ask the filesystem instead. Every probe
// below is satisfied on Linux and macOS, so CI skips nothing.

/** Can this host create a FILE symlink? Windows needs Developer Mode or elevation. */
function canCreateFileSymlink(): boolean {
    let dir: string | undefined;
    try {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-symlink-probe-'));
        writeFileSync(join(dir, 'target'), '');
        symlinkSync(join(dir, 'target'), join(dir, 'link'));
        return true;
    } catch {
        return false;
    } finally {
        if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
}

/** Is a runnable `gjs` on PATH? No prebuilt libgjs exists for Windows at all. */
function hasGjs(): boolean {
    try {
        execFileSync('gjs', ['--version'], { stdio: 'ignore', timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Is a POSIX `sh` on PATH? Exactly one row needs one, and it needs a REAL one:
 * it asserts that `include-args` survives the unquoted `$INCLUDE_ARGS`
 * expansion in main.yml's `su … -c "… sh -c '…'"` nesting, which is a claim
 * about a Linux CI container that only a shell can answer.
 *
 * Note what this probe is NOT gated on. `process.platform === 'win32'` would be
 * wrong twice over: Git for Windows ships an `sh.exe` (so a Windows host may
 * well have one), and a minimal Linux container might not. It also has to be
 * `execFileSync` with `shell: false` — asking a shell whether a shell exists
 * answers a different question.
 */
function hasPosixShell(): boolean {
    try {
        execFileSync('sh', ['-c', 'exit 0'], { stdio: 'ignore', timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

const skip: Record<string, string> = {};

if (!canCreateFileSymlink()) {
    const why = 'host cannot create file symlinks (Windows needs Developer Mode or elevation)';
    skip['copies a DANGLING link as-is instead of inventing a kind'] = why;
    skip['REFRESHES an existing `pkg` on the POSIX path'] = why;
    skip['still writes a relative symlink on POSIX'] = why;
}

if (!hasGjs()) {
    const why = 'no gjs on PATH — these spawn a real gjs child';
    skip['stdout contains only the child output — no banner'] = why;
    skip['positional extra args are forwarded to the gjs child'] = why;
}

if (!hasPosixShell()) {
    // The sibling row `github-actions include-args carries NO quoting` asserts
    // the same value as a STRING and runs everywhere, so what is lost here is
    // the word-splitting proof, not the coverage of the format itself.
    skip['include-args word-splits into exactly the argv CI intends'] =
        'no POSIX sh on PATH — this row expands the value in a real shell';
}

// `fs.chmod` on Windows only toggles the read-only flag — there is no mode to
// assert. This one IS a platform property, not a configurable capability.
if (process.platform === 'win32') {
    skip['writes the cache file with 0600 perms'] = 'no POSIX mode bits on this filesystem';
}

run(
    {
        bundlerPickSuite,
        reflectionTransformOrderSuite,
        cliFailSuite,
        shipPlanSuite,
        shipLayoutSuite,
        shipPayloadSuite,
        shipTypelibsSuite,
        shipLauncherSuite,
        shipSettingsSuite,
        shipLocalesSuite,
        msgfmtMergeSuite,
        shipMimeSuite,
        shipLicenseSuite,
        shipDependsSuite,
        shipNodeRuntimeSuite,
        shipAppRuntimeSuite,
        shipFlatpakSuite,
        shipPlistSuite,
        installProvenanceSuite,
        shipArchivesSuite,
        shipPackersSuite,
        shipSigningSuite,
        installProjectEngineSuite,
        giRuntimePathsBannerSuite,
        processStubBannerSuite,
        barrelsGenerateSuite,
        npmOidcSuite,
        publishDiagnoseSuite,
        publishHeadersSuite,
        cliRuntimeClosureSuite,
        whoamiCommandSuite,
        installBackendParseSpecSuite,
        installTarballCacheSuite,
        installPackumentCacheSuite,
        authNpmrcSuite,
        promptKeySuite,
        dirLinkSuite,
        resolveBinOnPathSuite,
        showcasePreflightSuite,
        checkSystemDepsSuite,
        dlxCacheSuite,
        installCacheFsSuite,
        installLockSuite,
        installBackendNativeWarnSuite,
        installOptionalEdgesSuite,
        detectNativePackagesSuite,
        giSearchPathSuite,
        systemGiSuite,
        giTypelibSuite,
        platformCheckSuite,
        binShimSuite,
        gjsifyShimSuite,
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
        onboardDiscoverySuite,
        promptOutputSuite,
        resolvePluginByNameSuite,
        runtimeSuite,
        gjsEntryWrapperSuite,
        entryPointsSuite,
        pkgJsonSuite,
        rewriteNodeModulesSpecSuite,
        buildArgsSuite,
        clearTargetsSuite,
        copyTargetsSuite,
        pinHintSuite,
        configSuite,
        libraryOutputSuite,
        suggestSuite,
        runtimesSuite,
        devPlanSuite,
        watchLoopSuite,
        spawnSuite,
        win32CommandSuite,
        gjsBundleGuardSuite,
        gjsSourceEscapeSuite,
        jsxConfigSuite,
        nodeBundleGuardSuite,
        prunePrefixSuite,
        unresolvedWorkspaceImportSuite,
        platformResolveSuite,
        reactNativeAliasSuite,
        reactNativeGateSuite,
    },
    { skip },
);
