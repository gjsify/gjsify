// Public re-exports for `@gjsify/rolldown-plugin-gjsify`.

export * from './types/index.js';
export * from './utils/index.js';
export * from './app/index.js';
export * from './library/index.js';

export {
    REWRITE_FILTER,
    extractPackageSpec,
    getBundleDirFromOutput,
    rewriteContents,
    shouldRewrite,
    shouldInline,
    nodeModulesPathRewritePlugin,
} from './plugins/rewrite-node-modules-paths.js';
export type { NodeModulesPathRewriteOptions, RewriteResult } from './plugins/rewrite-node-modules-paths.js';

export { processStubPlugin, GJS_PROCESS_STUB, composeBanner } from './plugins/process-stub.js';
export { giRuntimePathsStub } from './plugins/gi-runtime-paths.js';
export type { GiSystemProbe } from './plugins/gi-runtime-paths.js';
export type { ProcessStubPluginOptions } from './plugins/process-stub.js';
export { cssAsStringPlugin } from './plugins/css-as-string.js';
export { textLoaderPlugin } from './plugins/text-loader.js';
export type { TextLoaderPluginOptions, LoaderKind } from './plugins/text-loader.js';
export { shebangPlugin, GJS_SHEBANG, NODE_SHEBANG, expandEnvTemplate, resolveShebangLine } from './plugins/shebang.js';
export type { ShebangPluginOptions } from './plugins/shebang.js';
export { aliasPlugin } from './plugins/alias.js';
export type { AliasPluginOptions } from './plugins/alias.js';
export { gjsImportsEmptyPlugin } from './plugins/gjs-imports-empty.js';
export { externalsPlugin } from './plugins/externals.js';
export type { ExternalsPredicate, ExternalsPluginOptions } from './plugins/externals.js';
export {
    unresolvedWorkspaceImportPlugin,
    classifyImport,
    isWorkspaceSpecifier,
    formatUnresolvedWorkspaceImport,
    buildReverseAliasIndex,
    UnresolvedWorkspaceImportError,
} from './plugins/unresolved-workspace-import.js';
export type {
    WorkspaceImportGuardOptions,
    WorkspaceImportGuardTarget,
    ImportVerdict,
    ClassifyImportInput,
    UnresolvedWorkspaceImportDetails,
} from './plugins/unresolved-workspace-import.js';
export {
    napiNodeAddonPlugin,
    resolveAddonPath,
    nearestPackageRoot,
    classifySpecifier,
    directNodeShim,
    nodeGypBuildShim,
    bindingsShim,
    napiRsShim,
    ADDON_FILTER_RE,
    isNapiRsPackageJson,
    isNapiRsSibling,
    isGjsifyNativeBridge,
    detectNapiRsEntry,
    hostNapiRsTriple,
    AddonNotBuiltError,
} from './plugins/napi-node-addon.js';
export type { NapiNodeAddonPluginOptions, AddonPackageJson } from './plugins/napi-node-addon.js';
export {
    platformResolvePlugin,
    detectNativescriptPlatform,
    nativescriptPlatformDefines,
} from './plugins/platform-resolve.js';
export type { PlatformResolvePluginOptions, NativescriptPlatform } from './plugins/platform-resolve.js';
export {
    rnRouteManifestPlugin,
    renderRouteManifest,
    walkRoutes,
    RouteManifestError,
    RN_ROUTES_MODULE_ID,
    MAX_ROUTE_DEPTH,
} from './plugins/rn-route-manifest.js';
export type { RnRouteManifestOptions, FoundRoute } from './plugins/rn-route-manifest.js';

export * from './plugin.js';
import { gjsifyPlugin } from './plugin.js';
export { gjsifyPlugin };
export default gjsifyPlugin;

export * from '@gjsify/resolve-npm';
