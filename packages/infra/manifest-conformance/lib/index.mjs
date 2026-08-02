/**
 * `@gjsify/manifest-conformance` — check that what a `package.json` DECLARES
 * matches what the package actually ships.
 *
 * Importing this module REGISTERS the portable rule set. That is deliberate:
 * the registry is the single place that knows what exists, and a rule module
 * that has to be remembered separately is a rule module that will be forgotten
 * — which is the failure this package was built to remove.
 *
 * Repo-scoped rules (this repository's CI matrix, its internal alias table, its
 * heuristic runtime-slot suggestion) register themselves from
 * `scripts/manifest-conformance/`. They are NOT exported here: they read things
 * a consumer's tree does not have, and shipping them would give confidently
 * wrong answers rather than no answer.
 */

export { defineRule, allRules, portableRules, getRule, selectRules, runRules, claimedGjsifyFields, rulesClaimingField } from './registry.mjs';
export { createContext, readManifest, packagesUnder } from './context.mjs';
export {
    checkPrebuildDir,
    readLibrary,
    readTypelibSharedLibraries,
    readElfNeeded,
    readElfGlibcRequires,
    compareGlibcVersions,
} from './binary.mjs';
export { PLATFORM_RE, ARCH_ALIASES, KNOWN_ARCH_TOKENS, canonicalPlatform, LIB_EXT, HOST_TARGET } from './platforms.mjs';
export * from './source-graph.mjs';
export { renderReport, formatFindings } from './report.mjs';

// ── the portable rule set — importing this module registers all of them ──
export { packageOutputsRule, declaredPaths, targetFor, isCheckablePath, inspectDeclaredOutputs } from './rules/package-outputs.mjs';
export {
    prebuildArtifactsRule,
    collectNativePackages,
    auditPrebuildArtifacts,
    renderPrebuildSummary,
    dlopenProbe,
} from './rules/prebuild-artifacts.mjs';
export {
    headlessRule,
    auditHeadless,
    collectHeadlessMeta,
    walkHeadlessGraph,
    rootEntrySource,
    workspaceEntrySource,
    typelibOfSpecifier,
    normalizeTypelib,
    renderReachPath,
} from './rules/headless.mjs';
export {
    prebuildLibcRule,
    auditPrebuildLibc,
    collectLibcPackages,
    measurePrebuildLibc,
    renderPrebuildLibcSummary,
    libcFlavourOfNeeded,
    parsePrebuildTarget,
    canonicalPrebuildTarget,
    hostPrebuildTarget,
} from './rules/prebuild-libc.mjs';
export { portableScriptsRule, unportableCommands } from './rules/portable-scripts.mjs';
export { fieldCoverageRule, declaredGjsifyFields } from './rules/field-coverage.mjs';
