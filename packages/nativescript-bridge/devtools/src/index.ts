// @gjsify/devtools-nativescript — in-app NativeScript devtools agent.
//
// MIRRORS the GTK `@gjsify/devtools` shape (install / view-tree / screenshot /
// handlers) but uses NativeScript APIs and reuses the transport-agnostic
// `@gjsify/devtools-protocol` MethodRegistry verbatim. The host-side MCP bridge
// (`@gjsify/devtools-mcp`, `nativescriptProfile`) reaches the installed
// `globalThis.__adwDevtools.dispatch(...)` over the V8 CDP inspector.
//
// Pure named exports; no top-level side effects.

export {
    createAgent,
    installDevtools,
    uninstallDevtools,
    isNativeScript,
    type InstallNsDevtoolsOptions,
    type NsDevtoolsAgent,
} from './install.js';

export {
    createNativescriptRegistry,
    type NsDevtoolsContext,
    type NsDevtoolsExtension,
    type NsDevtoolsMethod,
    type ScreenshotResult,
} from './handlers.js';

export {
    buildViewPath,
    dumpTree,
    listToplevels,
    parseViewPath,
    readViewProperty,
    resolveViewPath,
    rootView,
    viewType,
    type NsApplicationLike,
    type NsFrameLike,
    type NsView,
    type ParsedViewPath,
} from './view-tree.js';

// Re-export the transport-agnostic contract so a consumer needs one import.
export * from '@gjsify/devtools-protocol';
