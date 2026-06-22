// @gjsify/devtools-browser — public surface.
// Pure named exports (no /register, no globalThis writes at module load).

export { BrowserCore, BUILTIN_PAGE_URLS, DEFAULT_HOME_URL } from './browser-core.js';
export type { BrowserHandle, IFrameHandle, NavState, PageLoadedInfo } from './browser-core.js';

export { BrowserWindow } from './browser-window.js';
export type { BrowserWindowOptions } from './browser-window.js';

export { browserDevtoolsExtension } from './browser-devtools-extension.js';
export type { BrowserDevtoolsExtensionOptions } from './browser-devtools-extension.js';

export {
    buildInspectElementExpression,
    buildDomTreeExpression,
    buildNetworkExpression,
    buildAccessibilityExpression,
} from './inspector.js';
export type { BoxEdges, BoxModel, InspectedElement, DomNode, AccessibilityNode, NetworkEntry } from './inspector.js';

export { BrowserApplication, runBrowserDevtools } from './run.js';
export type { RunBrowserDevtoolsOptions } from './run.js';
